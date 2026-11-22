"""Versioned boundary between the authenticated Edge gateway and the model.

The gateway supplies its current tool schemas, not credentials or executable code.
Tools are restricted again here; business validation stays with the tool executor.
"""

from typing import Any, Literal

from jsonschema import Draft202012Validator
from jsonschema.exceptions import SchemaError
from pydantic import BaseModel, ConfigDict, Field, model_validator

AgentKind = Literal["discover", "discover_plan", "trip_chat"]
ALLOWED_TOOLS = {
    "discover": {"search_places", "inspect_places", "select_cards", "report_limit"},
    "discover_plan": {
        "inspect_places",
        "research_venue",
        "propose_schedule",
        "check_routes",
        "finish_plan",
        "report_limit",
    },
    "trip_chat": {
        "read_wallet",
        "prepare_virtual_payment",
        "read_trip_information",
        "inspect_saved_places",
        "check_official_info",
        "propose_change",
        "propose_day_swap",
        "ask_follow_up",
        "respond",
    },
}


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


def check_schema(value: Any, depth: int = 0) -> None:
    if depth > 24:
        raise ValueError("Tool schema is too deeply nested")
    if isinstance(value, dict):
        # No remote schema resolution, arbitrary formats or regular expressions.
        if {"$ref", "$dynamicRef", "pattern", "patternProperties"} & value.keys():
            raise ValueError("Unsupported tool schema keyword")
        for child in value.values():
            check_schema(child, depth + 1)
    elif isinstance(value, list):
        for child in value:
            check_schema(child, depth + 1)


class FunctionSpec(Contract):
    name: str = Field(min_length=1, max_length=64, pattern=r"^[a-z][a-z_]+$")
    description: str = Field(min_length=1, max_length=4000)
    parameters: dict[str, Any]

    @model_validator(mode="after")
    def valid_schema(self):
        check_schema(self.parameters)
        try:
            Draft202012Validator.check_schema(self.parameters)
        except SchemaError:
            raise ValueError("Invalid JSON schema") from None
        if self.parameters.get("type") != "object":
            raise ValueError("Tool arguments must be an object")
        return self


class ToolSpec(Contract):
    type: Literal["function"] = "function"
    function: FunctionSpec


class DecisionRequest(Contract):
    version: Literal[1] = 1
    agent: AgentKind
    system: str = Field(min_length=1, max_length=16000)
    observation: dict[str, Any]
    tools: list[ToolSpec] = Field(min_length=1, max_length=12)
    max_output_tokens: int = Field(default=2600, ge=128, le=4000)

    @model_validator(mode="after")
    def valid_tools(self):
        names = [tool.function.name for tool in self.tools]
        if len(set(names)) != len(names) or not set(names) <= ALLOWED_TOOLS[self.agent]:
            raise ValueError("Tool is not available for this agent")
        return self


class ToolCall(Contract):
    name: str
    args: dict[str, Any]


class Usage(Contract):
    input_tokens: int = Field(default=0, ge=0)
    output_tokens: int = Field(default=0, ge=0)


class DecisionResponse(Contract):
    version: Literal[1] = 1
    call: ToolCall | None = None
    invalid: str | None = None
    usage: Usage = Field(default_factory=Usage)
    attempts: int = Field(ge=1, le=2)
