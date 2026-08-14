"""Focused request-boundary and release-hardening evidence."""

from __future__ import annotations

import asyncio
from uuid import uuid4

from backend.app.core.validation import normalize_idempotency_key, validate_confirmation_token
from backend.app.domain.imports import ImportValidationError, safe_upload_filename


def test_mutation_metadata_is_bounded_and_visible_ascii_only():
    assert normalize_idempotency_key("  retry-01  ") == "retry-01"
    assert normalize_idempotency_key(None) is None

    for value in ("x" * 129, "retry\nforged", "retry\tforged"):
        try:
            normalize_idempotency_key(value)
        except ValueError:
            pass
        else:
            raise AssertionError("unsafe idempotency metadata must be rejected")

    token = "a" * 32
    assert validate_confirmation_token(token) == token
    for value in ("short", "a" * 257, "a\n" + "b" * 30):
        try:
            validate_confirmation_token(value)
        except ValueError:
            pass
        else:
            raise AssertionError("unsafe confirmation metadata must be rejected")


def test_upload_filename_is_metadata_only_and_cannot_carry_control_chars():
    assert safe_upload_filename(r"C:\uploads\customers.csv") == "customers.csv"
    for filename in ("customers.csv\nX", "../customers.csv\x00", "customers.txt"):
        try:
            safe_upload_filename(filename)
        except ImportValidationError:
            pass
        else:
            raise AssertionError("unsafe upload filename must be rejected")


def test_chat_confirmation_rejects_invalid_token_before_database_lookup(client_factory):
    async def request(app):
        import httpx

        async with app.router.lifespan_context(app):
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="http://test"
            ) as client:
                return await client.post(
                    f"/api/v1/chat/staged-actions/{uuid4()}/confirm",
                    headers={
                        "Idempotency-Key": "hardening-key",
                        "X-Confirmation-Token": "short",
                    },
                )

    response = asyncio.run(request(client_factory().app))
    assert response.status_code == 409
    assert response.json()["code"] == "staged_action_invalid"


def test_customer_create_rejects_oversized_idempotency_key(client_factory):
    with client_factory() as client:
        response = client.post(
            "/api/v1/customers",
            headers={"Idempotency-Key": "x" * 129},
            json={},
        )
    assert response.status_code == 400
    assert response.json()["code"] == "idempotency_key_invalid"
