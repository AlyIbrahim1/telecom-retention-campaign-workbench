"""Pydantic contracts used at the HTTP and domain boundaries."""

from backend.app.schemas.customer import (
    CANONICAL_MODEL_FIELDS,
    CustomerInput,
    NormalizedCustomer,
    ValidationWarning,
    normalize_customer_payload,
    normalize_csv_row,
)
from backend.app.schemas.prediction import PredictionResponse

__all__ = [
    "CANONICAL_MODEL_FIELDS",
    "CustomerInput",
    "NormalizedCustomer",
    "PredictionResponse",
    "ValidationWarning",
    "normalize_customer_payload",
    "normalize_csv_row",
]
