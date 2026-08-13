"""HTTP contracts for grounded chat and explicit customer confirmation."""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from backend.app.schemas.customer import CustomerInput
from backend.app.schemas.prediction import PredictionResponse


class ChatSessionCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    customer_id: str | None = Field(default=None, min_length=1, max_length=64)
    campaign_id: UUID | None = None
    context: dict[str, Any] = Field(default_factory=dict)


class ChatSessionResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    session_id: UUID
    status: Literal["active", "closed"]
    customer_id: str | None = None
    campaign_id: UUID | None = None
    context: dict[str, Any] = Field(default_factory=dict)
    ai_available: bool = True
    unavailable_reason: str | None = None
    messages: list["ChatMessageResponse"] = Field(default_factory=list)
    staged_actions: list["ChatStagedActionResponse"] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


class ChatMessageResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    message_id: UUID
    role: Literal["user", "assistant", "tool", "system"]
    content: str
    kind: str = "message"
    provider_response_id: str | None = None
    created_at: datetime


class ChatStagedActionCreate(BaseModel):
    """Direct, UI-friendly route contract for the same preview tool."""

    model_config = ConfigDict(extra="forbid", strict=True)

    action: Literal["create", "update"]
    customer: CustomerInput
    expected_version: int | None = Field(default=None, ge=1)
    idempotency_key: str | None = Field(default=None, min_length=1, max_length=128)


class ChatStagedActionResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    action_id: UUID
    session_id: UUID
    action: Literal["create", "update"]
    status: Literal["pending", "consumed", "cancelled", "expired"]
    customer_id: str
    normalized_customer: CustomerInput
    prediction: PredictionResponse
    expected_version: int | None = None
    confirmation_token: str | None = None
    expires_at: datetime
    created_at: datetime


class ChatConfirmResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    action_id: UUID
    status: Literal["consumed"]
    customer: dict[str, Any]
    prediction: PredictionResponse


class ChatToolCall(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=64)
    arguments: dict[str, Any] = Field(default_factory=dict)

    @field_validator("arguments")
    @classmethod
    def bound_arguments(cls, value: dict[str, Any]) -> dict[str, Any]:
        if len(value) > 20 or any(not isinstance(key, str) or len(key) > 64 for key in value):
            raise ValueError("Tool arguments are too large")
        try:
            encoded = json.dumps(value, ensure_ascii=True, separators=(",", ":"))
        except (TypeError, ValueError) as exc:
            raise ValueError("Tool arguments are not JSON-safe") from exc
        if len(encoded.encode("utf-8")) > 32_768:
            raise ValueError("Tool arguments are too large")
        return value


class ChatProviderResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str = Field(default="", max_length=20_000)
    tool_calls: list[ChatToolCall] = Field(default_factory=list, max_length=4)
    response_id: str | None = Field(default=None, max_length=128)
    refused: bool = False


ChatSessionResponse.model_rebuild()
