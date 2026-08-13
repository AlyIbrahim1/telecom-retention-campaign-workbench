"""Correlation, request-size, security-header, and request-log middleware."""

from __future__ import annotations

import json
import time
from collections.abc import Awaitable, Callable
from typing import Any
from uuid import uuid4

from starlette.types import ASGIApp, Message, Receive, Scope, Send


SECURITY_HEADERS = (
    (b"content-security-policy", b"default-src 'none'; frame-ancestors 'none'"),
    (b"x-content-type-options", b"nosniff"),
    (b"x-frame-options", b"DENY"),
    (b"referrer-policy", b"no-referrer"),
)


class RequestTooLarge(Exception):
    """Raised when a streamed body crosses the configured byte limit."""


class HttpBoundaryMiddleware:
    """Enforce the shared HTTP safety boundary on every response."""

    def __init__(self, app: ASGIApp, max_request_bytes: int, logger: Any):
        self.app = app
        self.max_request_bytes = max_request_bytes
        self.logger = logger

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        started = time.perf_counter()
        correlation_id = uuid4().hex
        scope.setdefault("state", {})["correlation_id"] = correlation_id
        status = 500
        response_started = False

        async def safe_send(message: Message) -> None:
            nonlocal response_started, status
            if message["type"] == "http.response.start":
                response_started = True
                status = message["status"]
                headers = list(message.get("headers", []))
                header_names = {name.lower() for name, _ in headers}
                for name, value in SECURITY_HEADERS:
                    if name not in header_names:
                        headers.append((name, value))
                headers.append((b"x-correlation-id", correlation_id.encode("ascii")))
                message["headers"] = headers
            await send(message)

        if self._declared_size(scope) > self.max_request_bytes:
            status = 413
            await self._send_problem(scope, safe_send, correlation_id)
        else:
            received = 0

            async def limited_receive() -> Message:
                nonlocal received
                message = await receive()
                if message["type"] == "http.request":
                    received += len(message.get("body", b""))
                    if received > self.max_request_bytes:
                        raise RequestTooLarge
                return message

            try:
                await self.app(scope, limited_receive, safe_send)
            except RequestTooLarge:
                if response_started:
                    raise
                status = 413
                await self._send_problem(scope, safe_send, correlation_id)
            except Exception:
                if response_started:
                    raise
                status = 500
                self.logger.error("unexpected_request_error")
                await self._send_internal_error(safe_send, correlation_id)

        self.logger.info(
            "http_request",
            extra={
                "method": scope["method"],
                "path": scope["path"],
                "status": status,
                "duration_ms": round((time.perf_counter() - started) * 1000, 2),
                "correlation_id": correlation_id,
            },
        )

    @staticmethod
    def _declared_size(scope: Scope) -> int:
        for name, value in scope.get("headers", []):
            if name.lower() == b"content-length":
                try:
                    return int(value)
                except ValueError:
                    return 0
        return 0

    @staticmethod
    async def _send_problem(
        scope: Scope, send: Callable[[Message], Awaitable[None]], correlation_id: str
    ) -> None:
        del scope
        body = json.dumps(
            {
                "type": "https://retention-workbench.local/problems/request-too-large",
                "title": "Request too large",
                "status": 413,
                "detail": "The request exceeds the configured size limit.",
                "code": "request_too_large",
                "correlation_id": correlation_id,
            },
            separators=(",", ":"),
        ).encode("utf-8")
        await send(
            {
                "type": "http.response.start",
                "status": 413,
                "headers": [
                    (b"content-type", b"application/problem+json"),
                    (b"content-length", str(len(body)).encode("ascii")),
                ],
            }
        )
        await send({"type": "http.response.body", "body": body})

    @staticmethod
    async def _send_internal_error(
        send: Callable[[Message], Awaitable[None]], correlation_id: str
    ) -> None:
        body = json.dumps(
            {
                "type": "https://retention-workbench.local/problems/internal-error",
                "title": "Internal server error",
                "status": 500,
                "detail": "The server could not complete the request.",
                "code": "internal_error",
                "correlation_id": correlation_id,
            },
            separators=(",", ":"),
        ).encode("utf-8")
        await send(
            {
                "type": "http.response.start",
                "status": 500,
                "headers": [
                    (b"content-type", b"application/problem+json"),
                    (b"content-length", str(len(body)).encode("ascii")),
                ],
            }
        )
        await send({"type": "http.response.body", "body": body})
