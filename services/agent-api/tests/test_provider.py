"""Exercise the real LangChain provider serializer against a mocked HTTP transport."""

import json

import httpx
from langchain.chat_models import init_chat_model

from journeyhub_agent.contracts import DecisionRequest
from journeyhub_agent.graph import create_graph, decide

from .helpers import payload


async def test_openai_compatible_wire_protocol():
    requests = []

    async def handler(request):
        body = json.loads(request.content)
        requests.append(body)
        assert request.url.path == "/chat/completions"
        assert body["parallel_tool_calls"] is False
        assert body["tool_choice"] == "auto"
        assert body["tools"][0]["function"]["name"] == "respond"
        assert body["thinking"] == {"type": "disabled"}
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
                                    "function": {
                                        "name": "respond",
                                        "arguments": '{"items":["Verified."]}',
                                    },
                                }
                            ],
                        },
                    }
                ],
                "usage": {"prompt_tokens": 11, "completion_tokens": 7, "total_tokens": 18},
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        model = init_chat_model(
            "fixture",
            model_provider="openai",
            api_key="fixture",
            base_url="https://model.invalid",
            http_async_client=client,
            use_responses_api=False,
            max_retries=0,
            extra_body={"thinking": {"type": "disabled"}},
        )
        result = await decide(create_graph(model), DecisionRequest.model_validate(payload()))
    assert result.call.args == {"items": ["Verified."]}
    assert result.usage.input_tokens == 11
    assert result.usage.output_tokens == 7
    assert len(requests) == 1
