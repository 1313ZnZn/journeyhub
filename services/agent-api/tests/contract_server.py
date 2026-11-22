"""Loopback-only test server with a deterministic fake model HTTP transport.

This is deliberately outside the production package and Docker image. It is NOT
a live model evaluation. The real LangChain serializer, graph and FastAPI run.
"""

import json
import socket

import httpx
import uvicorn
from langchain.chat_models import init_chat_model

from journeyhub_agent.app import create_app

from .helpers import SETTINGS


async def fake_provider(request):
    body = json.loads(request.content)
    observation = json.loads(body["messages"][-1]["content"])
    names = {t["function"]["name"] for t in body["tools"]}
    correction = len(body["messages"]) > 2
    if "respond" in names:
        if not correction and "repair-fixture" in observation.get("request", ""):
            name, args = "not_a_registered_tool", {}
        elif not observation.get("recentObservations"):
            name, args = "read_trip_information", {"ids": [observation["stops"][0]["id"]]}
        else:
            observed = observation["recentObservations"][-1]["information"][0]
            name, args = "respond", {"items": ["Saved visit: " + observed["name"] + "."]}
    elif "search_places" in names and not observation["priorQueries"]:
        name, args = "search_places", {"queries": [{"category": "Museums", "query": "博物馆"}]}
    elif "select_cards" in names:
        name, args = (
            "select_cards",
            {
                "places": [
                    {
                        "id": p["id"],
                        "name": p["name"],
                        "category": "Museums",
                        "addressEnglish": "Fixture Road",
                        "reason": "Matches museums.",
                    }
                    for p in observation["places"]
                ]
            },
        )
    elif "propose_schedule" in names:
        if observation["proposedSchedule"] is None:
            name, args = (
                "propose_schedule",
                {
                    "summary": "A museum visit.",
                    "stops": [
                        {
                            "placeId": observation["mustVisitPlaceIds"][0],
                            "day": 1,
                            "start": "10:00",
                            "end": "11:00",
                            "reason": "Museum visit.",
                        }
                    ],
                },
            )
        elif observation.get("routes"):
            name, args = "finish_plan", {}
        else:
            name, args = "check_routes", {}
    else:
        raise AssertionError("Unexpected fixture tool set")
    return httpx.Response(
        200,
        json={
            "id": "fixture",
            "object": "chat.completion",
            "created": 1,
            "model": "fixture",
            "choices": [
                {
                    "index": 0,
                    "finish_reason": "tool_calls",
                    "message": {
                        "role": "assistant",
                        "content": None,
                        "tool_calls": [
                            {
                                "id": "fixture-call",
                                "type": "function",
                                "function": {"name": name, "arguments": json.dumps(args)},
                            }
                        ],
                    },
                }
            ],
            "usage": {"prompt_tokens": 100, "completion_tokens": 20, "total_tokens": 120},
        },
    )


if __name__ == "__main__":
    client = httpx.AsyncClient(transport=httpx.MockTransport(fake_provider))
    model = init_chat_model(
        "fixture",
        model_provider="openai",
        api_key="fixture",
        base_url="https://model.invalid",
        http_async_client=client,
        use_responses_api=False,
        max_retries=0,
    )
    app = create_app(SETTINGS, model)
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    print("SERVER_PORT=" + str(sock.getsockname()[1]), flush=True)
    server = uvicorn.Server(uvicorn.Config(app, log_level="error", access_log=False))
    server.run(sockets=[sock])
