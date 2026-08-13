"""Trusted Joblib model loading and canonical-to-notebook prediction mapping."""

from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Mapping

import joblib
import pandas as pd

from backend.app.schemas.customer import (
    CustomerInput,
    ValidationWarning,
)
from backend.app.schemas.prediction import (
    DEFAULT_THRESHOLD,
    MODEL_VERSION,
    THRESHOLD_POLICY_VERSION,
    PredictionResponse,
)


EXPECTED_BUNDLE_VERSION = 1
EXPECTED_SKLEARN_VERSION = "1.9.0"
EXPECTED_POSITIVE_CLASS = 1
EXPECTED_THRESHOLD = DEFAULT_THRESHOLD
EXPECTED_FEATURE_COLUMNS = (
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
EXPECTED_CATEGORICAL_FEATURES = EXPECTED_FEATURE_COLUMNS[:4] + EXPECTED_FEATURE_COLUMNS[5:16] + (
    "PaymentMethod",
)
EXPECTED_NUMERIC_FEATURES = ("tenure", "MonthlyCharges", "TotalCharges")


class ModelLoadError(RuntimeError):
    """Raised when a configured executable model artifact is not trusted."""


@dataclass(frozen=True)
class ModelMetadata:
    model_version: str
    model_sha256: str
    threshold: float
    threshold_policy_version: str
    feature_columns: tuple[str, ...]
    positive_class: int
    sklearn_version: str


class TrustedModelLoader:
    """Verify and load one fixed model artifact exactly once per API process."""

    def __init__(
        self,
        path: str | Path,
        expected_sha256: str,
        *,
        loader: Callable[[str | Path], Any] = joblib.load,
    ) -> None:
        self.path = Path(path)
        self.expected_sha256 = expected_sha256.lower()
        self._loader = loader
        self._bundle: Mapping[str, Any] | None = None
        self._metadata: ModelMetadata | None = None

    @property
    def loaded(self) -> bool:
        return self._bundle is not None

    @property
    def bundle(self) -> Mapping[str, Any]:
        if self._bundle is None:
            self.load_once()
        assert self._bundle is not None
        return self._bundle

    @property
    def metadata(self) -> ModelMetadata:
        if self._metadata is None:
            self.load_once()
        assert self._metadata is not None
        return self._metadata

    def load_once(self) -> Mapping[str, Any]:
        if self._bundle is not None:
            return self._bundle
        if not self.expected_sha256 or len(self.expected_sha256) != 64:
            raise ModelLoadError("Configured model checksum is invalid")
        if not self.path.is_file():
            raise ModelLoadError("Configured model artifact is missing")

        digest = self._sha256(self.path)
        if digest != self.expected_sha256:
            raise ModelLoadError("Configured model checksum does not match")

        # Joblib/pickle is executable content.  This load occurs only after
        # the fixed read-only artifact's digest has been checked.
        try:
            bundle = self._loader(self.path)
        except Exception as exc:  # pragma: no cover - exact library errors vary
            raise ModelLoadError("Configured model artifact could not be loaded") from exc

        metadata = self._validate_bundle(bundle, digest)
        self._bundle = bundle
        self._metadata = metadata
        return bundle

    @staticmethod
    def _sha256(path: Path) -> str:
        digest = hashlib.sha256()
        with path.open("rb") as file:
            for block in iter(lambda: file.read(1024 * 1024), b""):
                digest.update(block)
        return digest.hexdigest()

    @staticmethod
    def _validate_bundle(bundle: Any, digest: str) -> ModelMetadata:
        if not isinstance(bundle, Mapping):
            raise ModelLoadError("Model artifact must contain a mapping bundle")
        required = {
            "bundle_version",
            "pipeline",
            "threshold",
            "positive_class",
            "target_mapping",
            "feature_columns",
            "categorical_features",
            "numeric_features",
            "sklearn_version",
        }
        missing = required.difference(bundle)
        if missing:
            raise ModelLoadError(f"Model bundle metadata is incomplete: {sorted(missing)}")
        if bundle["bundle_version"] != EXPECTED_BUNDLE_VERSION:
            raise ModelLoadError("Model bundle version is unsupported")
        if bundle["sklearn_version"] != EXPECTED_SKLEARN_VERSION:
            raise ModelLoadError("Model runtime compatibility is unsupported")
        if tuple(bundle["feature_columns"]) != EXPECTED_FEATURE_COLUMNS:
            raise ModelLoadError("Model feature order is incompatible")
        if tuple(bundle["numeric_features"]) != EXPECTED_NUMERIC_FEATURES:
            raise ModelLoadError("Model numeric feature metadata is incompatible")
        if tuple(bundle["categorical_features"]) != EXPECTED_CATEGORICAL_FEATURES:
            raise ModelLoadError("Model categorical feature metadata is incompatible")
        if bundle["positive_class"] != EXPECTED_POSITIVE_CLASS:
            raise ModelLoadError("Model positive class is incompatible")
        target_mapping = bundle["target_mapping"]
        if target_mapping != {"No": 0, "Yes": 1}:
            raise ModelLoadError("Model target mapping is incompatible")
        try:
            threshold = float(bundle["threshold"])
        except (TypeError, ValueError) as exc:
            raise ModelLoadError("Model threshold is invalid") from exc
        if not 0 <= threshold <= 1 or not math.isfinite(threshold):
            raise ModelLoadError("Model threshold is outside 0–1")
        if not math.isclose(threshold, EXPECTED_THRESHOLD, rel_tol=0, abs_tol=1e-12):
            raise ModelLoadError("Model threshold is incompatible")
        # The exported bundle contains a pipeline with [0, 1] classes.  Do
        # not assume probability column 1 if a future approved bundle changes
        # class ordering; locate the positive class explicitly at prediction.
        pipeline = bundle["pipeline"]
        classes = getattr(pipeline, "classes_", None)
        if classes is None or list(classes) != [0, 1]:
            raise ModelLoadError("Model classes are incompatible")
        if not callable(getattr(pipeline, "predict_proba", None)):
            raise ModelLoadError("Model pipeline does not expose predict_proba")
        smoke_input = pd.DataFrame(
            [
                {
                    "gender": "Female",
                    "SeniorCitizen": "No",
                    "Partner": "Yes",
                    "Dependents": "No",
                    "tenure": 3,
                    "PhoneService": "Yes",
                    "MultipleLines": "No",
                    "InternetService": "Fiber optic",
                    "OnlineSecurity": "No",
                    "OnlineBackup": "No",
                    "DeviceProtection": "No",
                    "TechSupport": "No",
                    "StreamingTV": "Yes",
                    "StreamingMovies": "Yes",
                    "Contract": "Month-to-month",
                    "PaperlessBilling": "Yes",
                    "PaymentMethod": "Electronic check",
                    "MonthlyCharges": 89.5,
                    "TotalCharges": 268.5,
                }
            ],
            columns=list(EXPECTED_FEATURE_COLUMNS),
        )
        try:
            smoke = pipeline.predict_proba(smoke_input)
            score = float(smoke[0][list(classes).index(EXPECTED_POSITIVE_CLASS)])
        except Exception as exc:  # pragma: no cover - sklearn details vary
            raise ModelLoadError("Model smoke prediction failed") from exc
        if not math.isfinite(score) or not 0 <= score <= 1:
            raise ModelLoadError("Model smoke score is invalid")
        return ModelMetadata(
            model_version=MODEL_VERSION,
            model_sha256=digest,
            threshold=threshold,
            threshold_policy_version=THRESHOLD_POLICY_VERSION,
            feature_columns=EXPECTED_FEATURE_COLUMNS,
            positive_class=EXPECTED_POSITIVE_CLASS,
            sklearn_version=EXPECTED_SKLEARN_VERSION,
        )


class ModelService:
    """Translate canonical customers to original model columns and score them."""

    def __init__(self, loader: TrustedModelLoader) -> None:
        self.loader = loader

    @property
    def metadata(self) -> ModelMetadata:
        return self.loader.metadata

    def predict(
        self,
        customer: CustomerInput,
        warnings: list[ValidationWarning] | None = None,
    ) -> PredictionResponse:
        bundle = self.loader.bundle
        values = customer.model_dump(mode="python")
        model_values = {
            "gender": values["gender"],
            "SeniorCitizen": values["senior_citizen"],
            "Partner": values["partner"],
            "Dependents": values["dependents"],
            "tenure": values["tenure"],
            "PhoneService": values["phone_service"],
            "MultipleLines": values["multiple_lines"],
            "InternetService": values["internet_service"],
            "OnlineSecurity": values["online_security"],
            "OnlineBackup": values["online_backup"],
            "DeviceProtection": values["device_protection"],
            "TechSupport": values["tech_support"],
            "StreamingTV": values["streaming_tv"],
            "StreamingMovies": values["streaming_movies"],
            "Contract": values["contract"],
            "PaperlessBilling": values["paperless_billing"],
            "PaymentMethod": values["payment_method"],
            "MonthlyCharges": float(values["monthly_charges"]),
            "TotalCharges": float(values["total_charges"]),
        }
        frame = pd.DataFrame([model_values], columns=list(self.metadata.feature_columns))
        try:
            scores = bundle["pipeline"].predict_proba(frame)
            classes = list(bundle["pipeline"].classes_)
            score = float(scores[0][classes.index(self.metadata.positive_class)])
        except Exception as exc:  # pragma: no cover - model library errors vary
            raise ModelLoadError("Model prediction failed") from exc
        if not math.isfinite(score) or not 0 <= score <= 1:
            raise ModelLoadError("Model prediction returned an invalid score")
        return PredictionResponse(
            customer_id=customer.customer_id,
            risk_score=score,
            recommended_for_review=score >= self.metadata.threshold,
            model_version=self.metadata.model_version,
            threshold=self.metadata.threshold,
            threshold_policy_version=self.metadata.threshold_policy_version,
            scored_at=pd.Timestamp.now(tz="UTC").to_pydatetime(),
            warnings=warnings or [],
        )
