""" evidence for the bounded customer dashboard list contract."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

import httpx
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.app.core.config import Settings
from backend.app.db.base import Base
from backend.app.main import create_app
from backend.app.ml.service import TrustedModelLoader


ROOT = Path(__file__).resolve().parents[2]
FIXTURES = json.loads((ROOT / "tests/fixtures/model-fixtures.json").read_text())
FIELD_MAP = {
    "SeniorCitizen": "senior_citizen",
    "Partner": "partner",
    "Dependents": "dependents",
    "PhoneService": "phone_service",
    "MultipleLines": "multiple_lines",
    "InternetService": "internet_service",
    "OnlineSecurity": "online_security",
    "OnlineBackup": "online_backup",
    "DeviceProtection": "device_protection",
    "TechSupport": "tech_support",
    "StreamingTV": "streaming_tv",
    "StreamingMovies": "streaming_movies",
    "Contract": "contract",
    "PaperlessBilling": "paperless_billing",
    "PaymentMethod": "payment_method",
    "MonthlyCharges": "monthly_charges",
    "TotalCharges": "total_charges",
}


def canonical_fixture(fixture: dict) -> dict:
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
    return create_app(
        settings=settings,
        database_check=lambda: True,
        model_loader=loader,
        session_factory=factory,
    )


async def request(app, method: str, path: str, **kwargs):
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            return await getattr(client, method)(path, **kwargs)


def seed_customers(app) -> None:
    for index, fixture in enumerate(FIXTURES):
        response = asyncio.run(
            request(
                app,
                "post",
                "/api/v1/customers",
                json=canonical_fixture(fixture),
                headers={"Idempotency-Key": f"customer-list-{index}"},
            )
        )
        assert response.status_code == 201, response.text


def test_customer_list_is_bounded_and_server_side_sorted():
    app = make_app()
    seed_customers(app)

    response = asyncio.run(
        request(
            app,
            "get",
            "/api/v1/customers?page=1&sort=customer_id&order=asc",
        )
    )

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 3
    assert body["page"] == 1
    assert body["page_size"] == 25
    assert [item["customer_id"] for item in body["items"]] == [
        "FIXTURE-HIGH-001",
        "FIXTURE-LOW-001",
        "FIXTURE-NEW-001",
    ]
    # The list projection does not fetch the full canonical customer payload.
    assert "customer" not in body["items"][0]
    assert "current_prediction" in body["items"][0]


def test_customer_list_search_and_filters_are_applied_by_the_api():
    app = make_app()
    seed_customers(app)

    search = asyncio.run(request(app, "get", "/api/v1/customers?q=fixture-high"))
    assert search.status_code == 200
    assert [item["customer_id"] for item in search.json()["items"]] == [
        "FIXTURE-HIGH-001"
    ]

    recommended = asyncio.run(
        request(
            app,
            "get",
            "/api/v1/customers?recommended=true&contract=Month-to-month&sort=customer_id&order=asc",
        )
    )
    assert recommended.status_code == 200
    assert [item["customer_id"] for item in recommended.json()["items"]] == [
        "FIXTURE-HIGH-001",
        "FIXTURE-NEW-001",
    ]

    missing_score = asyncio.run(
        request(app, "get", "/api/v1/customers?score_freshness=missing")
    )
    assert missing_score.status_code == 200
    assert missing_score.json()["total"] == 0


def test_customer_list_rejects_unbounded_page_sizes():
    app = make_app()
    response = asyncio.run(request(app, "get", "/api/v1/customers?page_size=10"))
    assert response.status_code == 422
