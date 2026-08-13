"""Small request-boundary validators shared by mutation routes.

These checks run before values reach a database column or an external
provider.  Keeping them in one module prevents each route from subtly
accepting a different form of key or token.
"""

from __future__ import annotations

from typing import Any


MAX_IDEMPOTENCY_KEY_LENGTH = 128
MAX_CONFIRMATION_TOKEN_LENGTH = 256


def normalize_idempotency_key(value: Any) -> str | None:
    """Return a safe visible-ASCII idempotency key, or ``None`` when absent."""

    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError("Idempotency-Key must be text")
    normalized = value.strip()
    if not normalized:
        return None
    if len(normalized) > MAX_IDEMPOTENCY_KEY_LENGTH:
        raise ValueError("Idempotency-Key is too long")
    # Header values are metadata, not arbitrary user content.  Restricting to
    # visible ASCII avoids control-character log/header injection and keeps the
    # value portable across PostgreSQL and SQLite tests.
    if any(ord(character) < 0x21 or ord(character) > 0x7E for character in normalized):
        raise ValueError("Idempotency-Key contains unsupported characters")
    return normalized


def validate_confirmation_token(value: Any) -> str:
    """Validate the short-lived token before hashing it."""

    if not isinstance(value, str):
        raise ValueError("Confirmation token must be text")
    if not 16 <= len(value) <= MAX_CONFIRMATION_TOKEN_LENGTH:
        raise ValueError("Confirmation token has an invalid length")
    if any(ord(character) < 0x21 or ord(character) > 0x7E for character in value):
        raise ValueError("Confirmation token contains unsupported characters")
    return value
