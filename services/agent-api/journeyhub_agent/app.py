"""Server-to-server API. Never expose the service token to a browser."""

import asyncio
import hmac
import json
import logging
import time
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from pydantic import ValidationError
from starlette.responses import JSONResponse

from .contracts import DecisionRequest, DecisionResponse
from .graph import create_graph, create_model, decide
from .settings import Settings

logger = logging.getLogger("journeyhub.agent")
MAX_REQUEST_BYTES = 262144


def create_app(settings: Settings | None = None, model=None) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if not logger.handlers:
            handler = logging.StreamHandler()
            handler.setFormatter(logging.Formatter("%(message)s"))
            logger.addHandler(handler)
        logger.setLevel(logging.INFO)
        app.state.settings = settings or Settings()
        app.state.graph = create_graph(model or create_model(app.state.settings))
        app.state.slots = asyncio.Semaphore(app.state.settings.max_concurrency)
        yield

    app = FastAPI(title="JourneyHub Agent Decision API", version="0.1.0", lifespan=lifespan)

    @app.exception_handler(HTTPException)
    async def safe_http_error(request, exc):
        return JSONResponse(
            {"error": exc.detail},
            status_code=exc.status_code,
            headers={"Cache-Control": "no-store"},
        )

    @app.get("/healthz")
    async def health():
        # Process readiness only: no model request and no claim of provider connectivity.
        return {"status": "ready", "runtime": "python-langchain", "contract_version": 1}

    @app.post("/v1/decide", response_model=DecisionResponse)
    async def decision(request: Request):
        config = app.state.settings
        expected = "Bearer " + config.service_token.get_secret_value()
        authorization = request.headers.get("authorization", "")
        if not hmac.compare_digest(authorization.encode(), expected.encode()):
            raise HTTPException(401, "UNAUTHORIZED")
        if request.headers.get("content-type", "").split(";")[0].strip() != "application/json":
            raise HTTPException(415, "JSON_REQUIRED")
        raw = bytearray()
        try:
            # Includes chunked bodies; Content-Length is not trusted.
            async with asyncio.timeout(5):
                async for chunk in request.stream():
                    if len(raw) + len(chunk) > MAX_REQUEST_BYTES:
                        raise HTTPException(413, "REQUEST_TOO_LARGE")
                    raw.extend(chunk)
        except TimeoutError:
            raise HTTPException(408, "REQUEST_TIMEOUT") from None
        try:
            payload = DecisionRequest.model_validate_json(raw)
        except (ValidationError, ValueError, RecursionError):
            # FastAPI's default validation errors can echo private prompt/input values.
            raise HTTPException(422, "INVALID_DECISION_REQUEST") from None
        started, request_id = time.monotonic(), uuid.uuid4().hex
        acquired, result, status = False, None, "error"
        try:
            try:
                async with asyncio.timeout(0.01):
                    await app.state.slots.acquire()
                acquired = True
            except TimeoutError:
                raise HTTPException(429, "SERVICE_BUSY") from None
            async with asyncio.timeout(config.request_timeout_seconds):
                result = await decide(app.state.graph, payload)
            status = "invalid" if result.invalid else "ok"
            return JSONResponse(result.model_dump(), headers={"Cache-Control": "no-store"})
        except TimeoutError:
            status = "timeout"
            raise HTTPException(504, "MODEL_TIMEOUT") from None
        except HTTPException:
            raise
        except Exception:
            # Do not expose or log provider response bodies, keys, prompts or conversation text.
            raise HTTPException(502, "MODEL_UNAVAILABLE") from None
        finally:
            if acquired:
                app.state.slots.release()
            logger.info(
                json.dumps(
                    {
                        "event": "agent_decision",
                        "request_id": request_id,
                        "agent": payload.agent,
                        "status": status,
                        "duration_ms": round((time.monotonic() - started) * 1000),
                        "attempts": result.attempts if result else 0,
                        "usage": result.usage.model_dump() if result else None,
                    }
                )
            )

    return app


app = create_app()
