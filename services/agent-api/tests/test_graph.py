import copy

import pytest
from langchain_core.messages import AIMessage
from pydantic import ValidationError

from journeyhub_agent.contracts import DecisionRequest
from journeyhub_agent.graph import create_graph, create_model, decide

from .helpers import SETTINGS, ScriptedModel, message, payload


async def test_registered_call_and_usage():
    model = ScriptedModel(message())
    result = await decide(create_graph(model), DecisionRequest.model_validate(payload()))
    assert result.call.name == "respond"
    assert result.usage.input_tokens == 100
    assert result.attempts == 1
    assert model.bindings[0][1] == {"tool_choice": "auto", "parallel_tool_calls": False}
    assert model.calls[0][1]["max_tokens"] == 2600
    assert "Private model prose" not in result.model_dump_json()


@pytest.mark.parametrize(
    "bad",
    [
        AIMessage(content="No tool"),
        message("delete_account"),
        message(args={"items": "wrong type"}),
        message(args={"items": ["x"], "unexpected": True}),
        message(args={}),
        message(args={"items": ["x"] * 5}),
        message(args={"items": ["x" * 20001]}),
        message(response_metadata={"finish_reason": "length"}),
        AIMessage(
            content="",
            invalid_tool_calls=[
                {
                    "name": "respond",
                    "args": "{broken",
                    "id": "broken",
                    "error": "invalid",
                }
            ],
        ),
        AIMessage(content="", tool_calls=[*message().tool_calls, *message().tool_calls]),
    ],
)
async def test_invalid_decision_is_repaired_once(bad):
    model = ScriptedModel(bad, message())
    result = await decide(create_graph(model), DecisionRequest.model_validate(payload()))
    assert result.call.name == "respond"
    assert result.attempts == 2
    assert len(model.calls) == 2
    assert "failed validation" in model.calls[1][0][1].content


async def test_exhausted_repair_returns_no_executable_call():
    model = ScriptedModel(message("shell"), message("shell"))
    result = await decide(create_graph(model), DecisionRequest.model_validate(payload()))
    assert result.call is None and result.invalid
    assert result.attempts == 2
    assert result.usage.input_tokens == 200
    assert result.usage.output_tokens == 40


@pytest.mark.parametrize(
    "mutation",
    [
        lambda p: p.update(agent="staff"),
        lambda p: p.update(version=2),
        lambda p: p.update(max_output_tokens=100000),
        lambda p: p.update(model_api_key="untrusted-key"),
        lambda p: p["tools"][0]["function"].update(name="cancel_booking"),
        lambda p: p["tools"].append(copy.deepcopy(p["tools"][0])),
        lambda p: p["tools"][0]["function"].update(parameters={"type": "not-a-type"}),
        lambda p: p["tools"][0]["function"]["parameters"].update({"$ref": "https://bad.invalid"}),
        lambda p: p["tools"][0]["function"]["parameters"].update({"pattern": "(a+)+$"}),
    ],
)
def test_contract_rejects_untrusted_or_invalid_tools(mutation):
    request = payload()
    mutation(request)
    with pytest.raises(ValidationError):
        DecisionRequest.model_validate(request)


async def test_no_cross_request_memory_on_shared_graph():
    model = ScriptedModel(message(), message())
    graph = create_graph(model)
    for owner in ["account-a", "account-b"]:
        request = payload()
        request["observation"] = {"request": owner, "conversation": []}
        await decide(graph, DecisionRequest.model_validate(request))
    assert "account-a" in model.calls[0][0][-1].content
    assert "account-a" not in model.calls[1][0][-1].content
    assert "account-b" in model.calls[1][0][-1].content


def test_real_langchain_model_is_configured_without_network():
    model = create_model(SETTINGS)
    assert type(model).__name__ == "ChatOpenAI"
    assert model.model_name == "deepseek-flash"
    assert model.max_retries == 0
    assert model.use_responses_api is False
