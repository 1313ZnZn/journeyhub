import asyncio
import json
import logging

import httpx
from fastapi.testclient import TestClient

from journeyhub_agent.app import MAX_REQUEST_BYTES, create_app

from .helpers import HEADERS, SETTINGS, ScriptedModel, message, payload


def test_authenticated_request_and_private_metrics(caplog):
    caplog.set_level(logging.INFO, logger="journeyhub.agent")
    model = ScriptedModel(message())
    with TestClient(create_app(SETTINGS, model)) as client:
        response = client.post("/v1/decide", json=payload(), headers=HEADERS)
        assert response.status_code == 200
        assert response.json()["call"]["name"] == "respond"
        assert response.headers["cache-control"] == "no-store"
        assert client.get("/healthz").json()["runtime"] == "python-langchain"
    log = next(r.message for r in caplog.records if r.name == "journeyhub.agent")
    metric = json.loads(log)
    assert metric["status"] == "ok" and metric["attempts"] == 1
    assert "What is planned" not in log
    assert "Private model prose" not in log
    assert "fixture-model-key" not in log


def test_auth_before_body_parsing_or_model_calls():
    model = ScriptedModel()
    with TestClient(create_app(SETTINGS, model)) as client:
        for authorization in [None, "Bearer wrong", "Bearer non-ascii-é"]:
            headers = {} if authorization is None else {"authorization": authorization.encode()}
            response = client.post("/v1/decide", content="not json", headers=headers)
            assert response.status_code == 401
    assert not model.calls


def test_validation_errors_do_not_echo_user_content():
    model = ScriptedModel()
    with TestClient(create_app(SETTINGS, model)) as client:
        request = payload()
        request["agent"] = "PRIVATE-INPUT"
        response = client.post("/v1/decide", json=request, headers=HEADERS)
        assert response.status_code == 422
        assert "PRIVATE-INPUT" not in response.text
        response = client.post("/v1/decide", content="{}", headers=HEADERS)
        assert response.status_code == 415
        headers = {**HEADERS, "Content-Type": "application/json"}
        response = client.post(
            "/v1/decide", content=b"x" * (MAX_REQUEST_BYTES + 1), headers=headers
        )
        assert response.status_code == 413
    assert not model.calls


def test_provider_failure_is_redacted_and_slot_is_released(caplog):
    caplog.set_level(logging.INFO, logger="journeyhub.agent")
    model = ScriptedModel(RuntimeError("PRIVATE-KEY provider body"), message())
    with TestClient(create_app(SETTINGS, model)) as client:
        response = client.post("/v1/decide", json=payload(), headers=HEADERS)
        assert response.status_code == 502
        assert "PRIVATE-KEY" not in response.text + caplog.text
        assert client.post("/v1/decide", json=payload(), headers=HEADERS).status_code == 200


class WaitingModel(ScriptedModel):
    def __init__(self):
        super().__init__()
        self.started = asyncio.Event()
        self.release = asyncio.Event()

    async def ainvoke(self, messages, **kwargs):
        self.started.set()
        await self.release.wait()
        return message()


async def test_deadline_and_concurrency_are_bounded():
    settings = SETTINGS.model_copy(update={"max_concurrency": 1, "request_timeout_seconds": 0.15})
    model = WaitingModel()
    app = create_app(settings, model)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app), base_url="http://test"
        ) as c:
            first = asyncio.create_task(c.post("/v1/decide", json=payload(), headers=HEADERS))
            await model.started.wait()
            second = await c.post("/v1/decide", json=payload(), headers=HEADERS)
            assert second.status_code == 429
            assert (await first).status_code == 504
            model.release.set()
            assert (await c.post("/v1/decide", json=payload(), headers=HEADERS)).status_code == 200
