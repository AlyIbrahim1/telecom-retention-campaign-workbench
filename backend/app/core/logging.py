"""Small structured logger that records request metadata, never payloads."""

import json
import logging
from datetime import UTC, datetime
from typing import Any


REDACTED_KEYS = {
    "authorization",
    "cookie",
    "database_url",
    "openai_api_key",
    "password",
    "secret",
    "token",
}


def redact(value: Any) -> Any:
    """Recursively hide values whose keys commonly contain secrets."""

    if isinstance(value, dict):
        return {
            key: "[REDACTED]" if key.lower() in REDACTED_KEYS else redact(item)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [redact(item) for item in value]
    return value


class JsonFormatter(logging.Formatter):
    """Format known safe log fields as one JSON object per line."""

    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "timestamp": datetime.now(UTC).isoformat(),
            "level": record.levelname,
            "event": record.getMessage(),
        }
        for name in (
            "method",
            "path",
            "status",
            "duration_ms",
            "correlation_id",
        ):
            if hasattr(record, name):
                payload[name] = getattr(record, name)
        return json.dumps(redact(payload), separators=(",", ":"))


def configure_logging(level: str) -> logging.Logger:
    logger = logging.getLogger("retention_workbench")
    logger.setLevel(level)
    logger.propagate = False
    if not logger.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(JsonFormatter())
        logger.addHandler(handler)
    return logger
