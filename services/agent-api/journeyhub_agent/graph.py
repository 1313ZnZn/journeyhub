"""A bounded decision graph; the existing Edge worker executes the returned tool.

START -> model -> validate -> END (valid / exhausted)
                    |-> repair -> model (at most one correction)

No process-local conversation memory: each call receives an owner-scoped snapshot
from the gateway. Supabase remains the durable checkpoint and authorization store.
"""

import json
from typing import Any, TypedDict

from jsonschema import Draft202012Validator
from langchain.chat_models import init_chat_model
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langgraph.graph import END, START, StateGraph

from .contracts import DecisionRequest, DecisionResponse, ToolCall, Usage
from .settings import Settings


def create_model(settings: Settings):
    return init_chat_model(
        settings.model,
        model_provider="openai",
        api_key=settings.model_api_key.get_secret_value(),
        base_url=settings.model_base_url,
        use_responses_api=False,
        timeout=25,
        max_retries=0,  # The graph and gateway own the retry budget.
        extra_body={"thinking": {"type": "disabled"}}
        if settings.deepseek_disable_thinking
        else None,
    )


class DecisionState(TypedDict, total=False):
    request: DecisionRequest
    message: AIMessage
    attempts: int
    usage: Usage
    call: ToolCall | None
    invalid: str | None
    correction: str


def create_graph(model: Any):
    async def model_node(state: DecisionState):
        request = state["request"]
        messages = [SystemMessage(content=request.system)]
        if state.get("correction"):
            messages.append(SystemMessage(content=state["correction"]))
        messages.append(HumanMessage(content=json.dumps(request.observation, ensure_ascii=False)))
        bound = model.bind_tools(
            [tool.model_dump() for tool in request.tools],
            tool_choice="auto",
            parallel_tool_calls=False,
        )
        message = await bound.ainvoke(messages, max_tokens=request.max_output_tokens)
        previous = state.get("usage", Usage())
        usage = message.usage_metadata or {}
        return {
            "message": message,
            "attempts": state.get("attempts", 0) + 1,
            "usage": Usage(
                input_tokens=previous.input_tokens + max(0, int(usage.get("input_tokens", 0))),
                output_tokens=previous.output_tokens + max(0, int(usage.get("output_tokens", 0))),
            ),
        }

    def validate_node(state: DecisionState):
        message, request = state["message"], state["request"]
        calls = message.tool_calls
        invalid = "Return exactly one complete registered tool call."
        # Never execute a partial/truncated result or choose an arbitrary call from a batch.
        if (
            message.response_metadata.get("finish_reason") == "length"
            or message.invalid_tool_calls
            or len(calls) != 1
        ):
            return {"call": None, "invalid": invalid}
        call = calls[0]
        tool = next((t for t in request.tools if t.function.name == call["name"]), None)
        if tool is None or not isinstance(call.get("args"), dict):
            return {"call": None, "invalid": invalid}
        try:
            encoded = json.dumps(call["args"], allow_nan=False)
        except (ValueError, TypeError):
            return {"call": None, "invalid": invalid}
        if len(encoded) > 20000:
            return {"call": None, "invalid": "Tool arguments exceed the size limit."}
        error = next(Draft202012Validator(tool.function.parameters).iter_errors(call["args"]), None)
        if error:
            # Only the schema rule is fed back, never arbitrary model content or raw values.
            return {"call": None, "invalid": f"Tool arguments failed the {error.validator} rule."}
        return {"call": ToolCall(name=call["name"], args=call["args"]), "invalid": None}

    def repair_node(state: DecisionState):
        return {
            "correction": (
                "Your previous response failed validation: "
                + state["invalid"]
                + " Follow the offered JSON schema and select one tool. Do not include reasoning."
            )
        }

    def route(state: DecisionState):
        return "repair" if state["invalid"] and state["attempts"] < 2 else END

    graph = StateGraph(DecisionState)
    graph.add_node("model", model_node)
    graph.add_node("validate", validate_node)
    graph.add_node("repair", repair_node)
    graph.add_edge(START, "model")
    graph.add_edge("model", "validate")
    graph.add_conditional_edges("validate", route, {"repair": "repair", END: END})
    graph.add_edge("repair", "model")
    return graph.compile()


async def decide(graph, request: DecisionRequest) -> DecisionResponse:
    state = await graph.ainvoke({"request": request}, config={"recursion_limit": 8})
    return DecisionResponse(
        call=state["call"],
        invalid=state["invalid"],
        usage=state["usage"],
        attempts=state["attempts"],
    )
