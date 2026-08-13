"""Canonical customer input and the one normalization path used by the API.

The model was trained with the original IBM CSV headings.  The application
domain deliberately uses snake_case instead.  This module owns the strict
domain contract; conversion to the model's headings lives in ``app.ml``.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Any, Literal, Mapping

from pydantic import BaseModel, ConfigDict, Field, field_serializer, field_validator, model_validator


YesNo = Literal["Yes", "No"]
MultipleLines = Literal["Yes", "No", "No phone service"]
InternetService = Literal["DSL", "Fiber optic", "No"]
InternetAddon = Literal["Yes", "No", "No internet service"]
Contract = Literal["Month-to-month", "One year", "Two year"]
PaymentMethod = Literal[
    "Bank transfer (automatic)",
    "Credit card (automatic)",
    "Electronic check",
    "Mailed check",
]


CANONICAL_MODEL_FIELDS = (
    "gender",
    "senior_citizen",
    "partner",
    "dependents",
    "tenure",
    "phone_service",
    "multiple_lines",
    "internet_service",
    "online_security",
    "online_backup",
    "device_protection",
    "tech_support",
    "streaming_tv",
    "streaming_movies",
    "contract",
    "paperless_billing",
    "payment_method",
    "monthly_charges",
    "total_charges",
)

ORIGINAL_MODEL_FIELDS = (
    "gender",
    "SeniorCitizen",
    "Partner",
    "Dependents",
    "tenure",
    "PhoneService",
    "MultipleLines",
    "InternetService",
    "OnlineSecurity",
    "OnlineBackup",
    "DeviceProtection",
    "TechSupport",
    "StreamingTV",
    "StreamingMovies",
    "Contract",
    "PaperlessBilling",
    "PaymentMethod",
    "MonthlyCharges",
    "TotalCharges",
)

CSV_TO_CANONICAL = {
    "customerID": "customer_id",
    "customer_id": "customer_id",
    **dict(zip(ORIGINAL_MODEL_FIELDS, CANONICAL_MODEL_FIELDS, strict=True)),
    **{field: field for field in CANONICAL_MODEL_FIELDS},
}


def canonical_customer_id(value: Any) -> str:
    """Apply the only identifier normalization allowed by the domain."""

    if not isinstance(value, str):
        raise ValueError("customer_id must be a string")
    normalized = value.strip().upper()
    if not 1 <= len(normalized) <= 64 or not all(
        character.isascii() and (character.isalnum() or character in "_-")
        for character in normalized
    ):
        raise ValueError("customer_id must contain only letters, digits, '_' or '-'")
    return normalized


class CustomerInput(BaseModel):
    """Strict, canonical customer payload.

    Only the identifier gets the documented trim/uppercase normalization.  A
    category with a casing or whitespace typo is rejected rather than guessed.
    """

    model_config = ConfigDict(extra="forbid", strict=True)

    customer_id: str = Field(min_length=1, max_length=64, pattern=r"^[A-Z0-9_-]+$")
    gender: Literal["Female", "Male"]
    senior_citizen: YesNo
    partner: YesNo
    dependents: YesNo
    tenure: int = Field(ge=0)
    phone_service: YesNo
    multiple_lines: MultipleLines
    internet_service: InternetService
    online_security: InternetAddon
    online_backup: InternetAddon
    device_protection: InternetAddon
    tech_support: InternetAddon
    streaming_tv: InternetAddon
    streaming_movies: InternetAddon
    contract: Contract
    paperless_billing: YesNo
    payment_method: PaymentMethod
    monthly_charges: Decimal = Field(ge=0)
    total_charges: Decimal = Field(ge=0)

    @field_validator("customer_id", mode="before")
    @classmethod
    def normalize_customer_id(cls, value: Any) -> Any:
        if isinstance(value, str):
            return canonical_customer_id(value)
        return value

    @field_validator("monthly_charges", "total_charges", mode="before")
    @classmethod
    def parse_finite_charges(cls, value: Any) -> Decimal:
        # JSON numbers arrive as Python ``int``/``float`` values.  Convert
        # those explicitly while rejecting booleans and non-numeric strings.
        if isinstance(value, bool) or not isinstance(value, (int, float, Decimal)):
            raise ValueError("Charge must be a finite number")
        try:
            value = Decimal(str(value))
        except (InvalidOperation, ValueError) as exc:
            raise ValueError("Charge must be a finite number") from exc
        if not value.is_finite():
            raise ValueError("Charge must be finite")
        return value

    @field_serializer("monthly_charges", "total_charges")
    def serialize_charges(self, value: Decimal) -> float:
        # Keep Decimal internally for database/model-boundary correctness,
        # while honoring the JSON contract's numeric charge fields.
        return float(value)

    @model_validator(mode="after")
    def validate_dependencies(self) -> "CustomerInput":
        if self.phone_service == "No" and self.multiple_lines != "No phone service":
            raise ValueError(
                "multiple_lines must be 'No phone service' when phone_service is 'No'"
            )
        if self.phone_service == "Yes" and self.multiple_lines == "No phone service":
            raise ValueError(
                "multiple_lines cannot be 'No phone service' when phone_service is 'Yes'"
            )

        add_on_names = (
            "online_security",
            "online_backup",
            "device_protection",
            "tech_support",
            "streaming_tv",
            "streaming_movies",
        )
        add_ons = {name: getattr(self, name) for name in add_on_names}
        if self.internet_service == "No" and any(
            value != "No internet service" for value in add_ons.values()
        ):
            raise ValueError(
                "Internet add-ons must be 'No internet service' when internet_service is 'No'"
            )
        if self.internet_service != "No" and any(
            value == "No internet service" for value in add_ons.values()
        ):
            raise ValueError(
                "Internet add-ons cannot be 'No internet service' when internet service is present"
            )
        if self.tenure > 0 and self.total_charges <= 0:
            raise ValueError("total_charges must be greater than zero when tenure is positive")
        return self


@dataclass(frozen=True)
class ValidationWarning:
    """A non-blocking warning shown before a customer is persisted."""

    code: Literal["out_of_distribution"]
    field: Literal["tenure", "monthly_charges", "total_charges"]
    message: str

    def as_dict(self) -> dict[str, str]:
        return {"code": self.code, "field": self.field, "message": self.message}


class NormalizedCustomer(BaseModel):
    """Validated customer plus warnings produced by the canonical path."""

    model_config = ConfigDict(extra="forbid")

    customer: CustomerInput
    warnings: list[ValidationWarning] = Field(default_factory=list)


def out_of_distribution_warnings(customer: CustomerInput) -> list[ValidationWarning]:
    warnings: list[ValidationWarning] = []
    if not 0 <= customer.tenure <= 72:
        warnings.append(
            ValidationWarning(
                code="out_of_distribution",
                field="tenure",
                message="Tenure is outside the observed training range of 0–72 months.",
            )
        )
    if not Decimal("18.25") <= customer.monthly_charges <= Decimal("118.75"):
        warnings.append(
            ValidationWarning(
                code="out_of_distribution",
                field="monthly_charges",
                message="Monthly charges are outside the observed training range of 18.25–118.75.",
            )
        )
    if customer.total_charges > Decimal("8684.8"):
        warnings.append(
            ValidationWarning(
                code="out_of_distribution",
                field="total_charges",
                message="Total charges are above the observed training maximum of 8684.8.",
            )
        )
    return warnings


def normalize_customer_payload(payload: Mapping[str, Any] | CustomerInput) -> NormalizedCustomer:
    """Validate an API/form payload and return canonical values and warnings."""

    customer = payload if isinstance(payload, CustomerInput) else CustomerInput.model_validate(payload)
    return NormalizedCustomer(customer=customer, warnings=out_of_distribution_warnings(customer))


def normalize_csv_row(row: Mapping[str, Any]) -> NormalizedCustomer:
    """Normalize one IBM CSV row at the import boundary.

    CSV is the only boundary allowed to map exact ``SeniorCitizen`` values
    ``0``/``1`` and to turn a blank zero-tenure ``TotalCharges`` into zero.
    """

    unknown = set(row).difference(CSV_TO_CANONICAL)
    if unknown:
        raise ValueError(f"Unexpected CSV columns: {sorted(unknown)}")
    canonical: dict[str, Any] = {}
    for heading, value in row.items():
        field = CSV_TO_CANONICAL[heading]
        if field in canonical:
            raise ValueError(f"Multiple headings map to {field}")
        canonical[field] = value

    senior = canonical.get("senior_citizen")
    if senior == 0 or senior == "0":
        canonical["senior_citizen"] = "No"
    elif senior == 1 or senior == "1":
        canonical["senior_citizen"] = "Yes"

    # CSV parsers expose numeric cells as strings or floats.  Convert them at
    # this boundary so the domain schema can remain strict for JSON/form input.
    try:
        if isinstance(canonical.get("tenure"), str):
            tenure_text = canonical["tenure"].strip()
            canonical["tenure"] = int(tenure_text)
        for field in ("monthly_charges", "total_charges"):
            value = canonical.get(field)
            if isinstance(value, str) and value.strip() != "":
                canonical[field] = Decimal(value.strip())
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise ValueError("CSV numeric value is invalid") from exc

    tenure = canonical.get("tenure")
    total = canonical.get("total_charges")
    if tenure in (0, 0.0, "0", "0.0") and (total is None or total == ""):
        canonical["total_charges"] = Decimal("0")
        normalized = normalize_customer_payload(canonical)
        normalized.warnings.append(
            ValidationWarning(
                code="out_of_distribution",
                field="total_charges",
                message="Blank zero-tenure TotalCharges was normalized to 0 from CSV.",
            )
        )
        return normalized
    return normalize_customer_payload(canonical)
