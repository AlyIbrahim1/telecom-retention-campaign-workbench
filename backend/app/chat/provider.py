"""Small OpenAI Responses adapter with a safe no-key fallback.

The domain owns tools and confirmation.  This module only translates bounded
conversation messages to/from the external provider; it never receives a
database session and cannot mutate application state.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Protocol

from pydantic import SecretStr

from backend.app.schemas.chat import ChatProviderResponse, ChatToolCall


class ProviderUnavailable(RuntimeError):
    """No API key/configuration is available for the optional provider."""


class ProviderTimeout(RuntimeError):
    """The provider exceeded the bounded request timeout."""


class ProviderRefusal(RuntimeError):
    """The provider declined to answer safely."""


class ProviderRateLimit(RuntimeError):
    """The provider asked the pilot to retry later."""


class ChatProvider(Protocol):
    def respond(self, messages: list[dict[str, Any]], tools: list[dict[str, Any]]) -> ChatProviderResponse:
        """Return one bounded assistant response or allowlisted tool calls."""


@dataclass(frozen=True)
class OpenAIResponsesProvider:
    """OpenAI-compatible Chat Completions adapter, including OpenRouter."""

    api_key: SecretStr | None
    base_url: str
    model: str
    timeout_seconds: float = 20.0
    max_output_tokens: int = 600

    def respond(self, messages: list[dict[str, Any]], tools: list[dict[str, Any]]) -> ChatProviderResponse:
        key = self.api_key.get_secret_value() if hasattr(self.api_key, "get_secret_value") else str(self.api_key or "")
        if not key.strip():
            raise ProviderUnavailable("OpenAI API key is not configured")
        try:
            from openai import OpenAI

            client = OpenAI(api_key=key, base_url=self.base_url, timeout=self.timeout_seconds)
            response = client.chat.completions.create(
                model=self.model,
                messages=messages,
                tools=self._chat_tools(tools),
                max_tokens=self.max_output_tokens,
            )
        except TimeoutError as exc:  # pragma: no cover - provider-specific
            raise ProviderTimeout from exc
        except Exception as exc:  # pragma: no cover - SDK/network details vary
            name = type(exc).__name__.lower()
            if getattr(exc, "status_code", None) == 429 or "rate" in name:
                raise ProviderRateLimit from exc
            if "timeout" in name:
                raise ProviderTimeout from exc
            if "refus" in name:
                raise ProviderRefusal from exc
            # Do not expose provider details in logs or HTTP responses.
            raise ProviderUnavailable from exc

        return self._response_payload(response)

    async def arespond(self, messages: list[dict[str, Any]], tools: list[dict[str, Any]]) -> ChatProviderResponse:
        """Use the SDK's native async client for the FastAPI request path."""

        key = self.api_key.get_secret_value() if hasattr(self.api_key, "get_secret_value") else str(self.api_key or "")
        if not key.strip():
            raise ProviderUnavailable("OpenAI API key is not configured")
        try:
            from openai import AsyncOpenAI

            client = AsyncOpenAI(api_key=key, base_url=self.base_url, timeout=self.timeout_seconds)
            response = await client.chat.completions.create(
                model=self.model,
                messages=messages,
                tools=self._chat_tools(tools),
                max_tokens=self.max_output_tokens,
            )
        except TimeoutError as exc:  # pragma: no cover - provider-specific
            raise ProviderTimeout from exc
        except Exception as exc:  # pragma: no cover - SDK/network details vary
            name = type(exc).__name__.lower()
            if getattr(exc, "status_code", None) == 429 or "rate" in name:
                raise ProviderRateLimit from exc
            if "timeout" in name:
                raise ProviderTimeout from exc
            if "refus" in name:
                raise ProviderRefusal from exc
            raise ProviderUnavailable from exc
        return self._response_payload(response)

    @staticmethod
    def _response_payload(response: Any) -> ChatProviderResponse:
        calls: list[ChatToolCall] = []
        choices = getattr(response, "choices", []) or []
        message = getattr(choices[0], "message", None) if choices else None
        for item in getattr(message, "tool_calls", []) or []:
            function = getattr(item, "function", None)
            name = str(getattr(function, "name", ""))
            raw_arguments = getattr(function, "arguments", "{}")
            try:
                arguments = json.loads(raw_arguments) if isinstance(raw_arguments, str) else dict(raw_arguments)
            except (TypeError, ValueError):
                # Malformed tool arguments are handled by the route as a safe
                # tool error instead of being passed into the domain.
                arguments = {"_malformed": True}
            calls.append(ChatToolCall(name=name, arguments=arguments))
        text = getattr(message, "content", "") or ""
        return ChatProviderResponse(
            text=str(text),
            tool_calls=calls,
            response_id=str(getattr(response, "id", "")) or None,
            refused=not bool(text or calls) and bool(getattr(message, "refusal", None)),
        )

    @staticmethod
    def _chat_tools(tools: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return [
            {
                "type": "function",
                "function": {
                    "name": tool["name"],
                    "description": tool.get("description", ""),
                    "parameters": tool.get("parameters", {}),
                },
            }
            for tool in tools
            if tool.get("type") == "function" and tool.get("name")
        ]


class UnavailableProvider:
    """Explicit provider object useful for startup and tests."""

    def respond(self, _messages: list[dict[str, Any]], _tools: list[dict[str, Any]]) -> ChatProviderResponse:
        raise ProviderUnavailable("AI provider is unavailable")
