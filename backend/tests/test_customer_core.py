""" contract evidence using an in-memory SQLAlchemy database."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

import httpx
import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from backend.app.core.config import Settings
from backend.app.db.base import Base
from backend.app.db.models import Customer, Prediction
from backend.app.main import create_app
from backend.app.ml.service import TrustedModelLoader
from backend.app.schemas.customer import normalize_csv_row, normalize_customer_payload


ROOT = Path(__file__).resolve().parents[2]
FIXTURES = json.loads((ROOT / "tests/fixtures/model-fixtures.json").read_text())
FIELD_MAP = {
    "SeniorCitizen": "senior_citizen", "Partner": "partner", "Dependents": "dependents",
    "PhoneService": "phone_service", "MultipleLines": "multiple_lines", "InternetService": "internet_service",
    "OnlineSecurity": "online_security", "OnlineBackup": "online_backup", "DeviceProtection": "device_protection",
    "TechSupport": "tech_support", "StreamingTV": "streaming_tv", "StreamingMovies": "streaming_movies",
    "Contract": "contract", "PaperlessBilling": "paperless_billing", "PaymentMethod": "payment_method",
    "MonthlyCharges": "monthly_charges", "TotalCharges": "total_charges",
}


def canonical_fixture(fixture):
    return {
        FIELD_MAP.get(key, key): value
        for key, value in fixture["input"].items()
        if key != "customerID"
    } | {"customer_id": fixture["input"]["customerID"]}


def make_app():
    settings = Settings(
        _env_file=None,
        app_env="test",
        database_url="postgresql+psycopg://test:test@localhost/test",
    )
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    loader = TrustedModelLoader(settings.model_path, settings.model_sha256)
    app = create_app(
        settings=settings,
        database_check=lambda: True,
        model_loader=loader,
        session_factory=factory,
    )
    return app, factory


def test_canonical_validation_rejects_unknown_and_cross_field_values():
    payload = canonical_fixture(FIXTURES[0])
    payload["customer_id"] = "  fixture-new  "
    normalized = normalize_customer_payload(payload)
    assert normalized.customer.customer_id == "FIXTURE-NEW"

    with pytest.raises(Exception):
        normalize_customer_payload({**payload, "internet_service": "No"})
    with pytest.raises(Exception):
        normalize_customer_payload({**payload, "unexpected": "value"})


def test_csv_boundary_normalizes_only_documented_values():
    row = dict(FIXTURES[2]["input"])
    row["SeniorCitizen"] = "0"
    row["TotalCharges"] = ""
    normalized = normalize_csv_row(row)
    assert normalized.customer.senior_citizen == "No"
    assert normalized.customer.total_charges == 0
    assert any(w.field == "total_charges" for w in normalized.warnings)


async def request(app, method: str, path: str, **kwargs):
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            return await getattr(client, method)(path, **kwargs)


@pytest.mark.parametrize("fixture", FIXTURES)
def test_fixture_prediction_reproduces_model_contract(fixture):
    app, _ = make_app()
    body = canonical_fixture(fixture)
    response = asyncio.run(request(app, "post", "/api/v1/customers/preview", json=body))
    assert response.status_code == 200
    assert response.json()["prediction"]["risk_score"] == pytest.approx(fixture["expected"]["risk_score"], abs=1e-10)


def test_create_is_idempotent_and_prediction_is_append_only():
    app, factory = make_app()
    body = canonical_fixture(FIXTURES[0])
    first = asyncio.run(request(app, "post", "/api/v1/customers", json=body, headers={"Idempotency-Key": "create-1"}))
    replay = asyncio.run(request(app, "post", "/api/v1/customers", json=body, headers={"Idempotency-Key": "create-1"}))
    assert first.status_code == replay.status_code == 201
    with factory() as session:
        assert len(session.scalars(select(Customer)).all()) == 1
        assert len(session.scalars(select(Prediction)).all()) == 1


def test_invalid_model_fails_readiness_without_exposing_loader_details(tmp_path):
    settings = Settings(
        _env_file=None,
        app_env="test",
        database_url="postgresql+psycopg://test:test@localhost/test",
        model_path=tmp_path / "missing.joblib",
        model_sha256="0" * 64,
    )
    app = create_app(
        settings=settings,
        database_check=lambda: True,
        model_loader=TrustedModelLoader(settings.model_path, settings.model_sha256),
    )
    response = asyncio.run(request(app, "get", "/health/ready"))
    assert response.status_code == 503
    assert response.json()["code"] == "service_unavailable"
    assert "missing.joblib" not in response.text


def test_update_requires_current_version_and_appends_prediction():
    app, factory = make_app()
    body = canonical_fixture(FIXTURES[0])
    created = asyncio.run(request(app, "post", "/api/v1/customers", json=body, headers={"Idempotency-Key": "create-update"}))
    assert created.status_code == 201
    updated = {**body, "monthly_charges": 91.25}
    changed = asyncio.run(request(app, "put", "/api/v1/customers/FIXTURE-HIGH-001", json=updated, headers={"Idempotency-Key": "update-1", "If-Match": "1"}))
    assert changed.status_code == 200
    assert changed.json()["customer"]["version"] == 2
    conflict = asyncio.run(request(app, "put", "/api/v1/customers/FIXTURE-HIGH-001", json=updated, headers={"Idempotency-Key": "update-2", "If-Match": "1"}))
    assert conflict.status_code == 409
    assert conflict.json()["code"] == "customer_version_conflict"
    with factory() as session:
        assert len(session.scalars(select(Prediction)).all()) == 2
