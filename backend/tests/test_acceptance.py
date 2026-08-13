""" route-level acceptance journey for the local pilot demo.

The test keeps the full workflow in one place so a future change cannot make
the documented demo path silently skip a confirmation boundary.
"""

from __future__ import annotations

import csv
import asyncio
import io
import json
import time
from pathlib import Path

import httpx
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.app.core.config import Settings
from backend.app.db.base import Base
from backend.app.db.models import CampaignSelection, Customer, Prediction
from backend.app.domain.imports import TEMPLATE_COLUMNS
from backend.app.main import create_app
from backend.app.ml.service import TrustedModelLoader


ROOT = Path(__file__).resolve().parents[2]
FIXTURES = json.loads((ROOT / "tests/fixtures/model-fixtures.json").read_text())
FIELD_MAP = {
    "customerID": "customer_id",
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


def payload(fixture_name: str, customer_id: str) -> dict:
    source = next(item["input"] for item in FIXTURES if item["name"] == fixture_name)
    return {FIELD_MAP.get(key, key): value for key, value in source.items()} | {
        "customer_id": customer_id
    }


def csv_bytes(customer: dict) -> bytes:
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=TEMPLATE_COLUMNS, lineterminator="\n")
    writer.writeheader()
    row = {
        heading: customer[FIELD_MAP.get(heading, heading)]
        for heading in TEMPLATE_COLUMNS
    }
    row["customerID"] = customer["customer_id"]
    row["SeniorCitizen"] = {"Yes": "1", "No": "0"}[row["SeniorCitizen"]]
    writer.writerow(row)
    return output.getvalue().encode("utf-8")


def test_demo_journey_covers_every_confirmation_boundary():
    """Exercise create -> update -> import -> campaign -> chat in one flow."""

    asyncio.run(_demo_journey())


async def _demo_journey():
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    settings = Settings(
        _env_file=None,
        app_env="test",
        database_url="postgresql+psycopg://test:test@localhost/test",
    )
    app = create_app(
        settings=settings,
        database_check=lambda: True,
        model_loader=TrustedModelLoader(settings.model_path, settings.model_sha256),
        session_factory=factory,
    )

    high = payload("high-risk-monthly-fiber", "ACCEPT-HIGH")
    high["monthly_charges"] = 91.0
    low = payload("established-two-year-dsl", "ACCEPT-LOW")
    chat_customer = payload("new-phone-and-internet-free", "ACCEPT-CHAT")

    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            assert (await client.get("/health/live")).json() == {"status": "live"}
            assert (await client.get("/health/ready")).status_code == 200
            assert (await client.get("/api/v1/meta/model")).status_code == 200

            preview = await client.post("/api/v1/customers/preview", json=high)
            assert preview.status_code == 200, preview.text
            assert preview.json()["prediction"]["customer_id"] == "ACCEPT-HIGH"

            created = await client.post(
                "/api/v1/customers",
                headers={"Idempotency-Key": "accept-create"},
                json=high,
            )
            assert created.status_code == 201, created.text
            assert created.json()["customer"]["version"] == 1

            high["monthly_charges"] = 92.0
            update_preview = await client.post(
                "/api/v1/customers/ACCEPT-HIGH/preview-update", json=high
            )
            assert update_preview.status_code == 200, update_preview.text
            updated = await client.put(
                "/api/v1/customers/ACCEPT-HIGH",
                headers={"If-Match": "1", "Idempotency-Key": "accept-update"},
                json=high,
            )
            assert updated.status_code == 200, updated.text
            assert updated.json()["customer"]["version"] == 2

            imported = await client.post(
                "/api/v1/imports/preflight?mode=create",
                files={"file": ("acceptance.csv", csv_bytes(low), "text/csv")},
            )
            assert imported.status_code == 200, imported.text
            assert imported.json()["valid_rows"] == 1
            job_id = imported.json()["job_id"]
            confirmed_import = await client.post(
                f"/api/v1/imports/{job_id}/confirm",
                headers={"Idempotency-Key": "accept-import"},
            )
            assert confirmed_import.status_code == 200, confirmed_import.text
            assert confirmed_import.json()["status"] == "queued"
            import_result = await client.get(f"/api/v1/imports/{job_id}")
            deadline = time.monotonic() + 10
            while import_result.json()["status"] in {"queued", "running"} and time.monotonic() < deadline:
                await asyncio.sleep(0.05)
                import_result = await client.get(f"/api/v1/imports/{job_id}")
            assert import_result.json()["status"] == "completed"

            campaign = await client.post(
                "/api/v1/campaigns",
                headers={"Idempotency-Key": "accept-campaign"},
                json={"name": "Acceptance campaign", "capacity": 1},
            )
            assert campaign.status_code == 201, campaign.text
            campaign_id = campaign.json()["campaign_id"]
            optimized = await client.post(
                f"/api/v1/campaigns/{campaign_id}/optimize",
                headers={"If-Match": "1"},
                json={},
            )
            assert optimized.status_code == 200, optimized.text
            assert optimized.json()["status"] == "optimized"
            assert optimized.json()["eligible_count"] >= 1

            override = await client.post(
                f"/api/v1/campaigns/{campaign_id}/overrides",
                headers={"If-Match": "2"},
                json={
                    "customer_id": "ACCEPT-LOW",
                    "action": "include",
                    "reason": "Approved demo exception",
                    "replacement_customer_id": "ACCEPT-HIGH",
                },
            )
            assert override.status_code == 200, override.text
            assert override.json()["version"] == 3
            confirmed = await client.post(
                f"/api/v1/campaigns/{campaign_id}/confirm",
                headers={
                    "If-Match": "3",
                    "Idempotency-Key": "accept-confirm",
                },
            )
            assert confirmed.status_code == 200, confirmed.text
            assert confirmed.json()["status"] == "confirmed"
            assert confirmed.json()["selected_count"] == 1

            chat_session = await client.post("/api/v1/chat/sessions", json={})
            assert chat_session.status_code == 201, chat_session.text
            chat_id = chat_session.json()["session_id"]
            staged = await client.post(
                f"/api/v1/chat/sessions/{chat_id}/staged-actions",
                headers={"Idempotency-Key": "accept-chat-stage"},
                json={"action": "create", "customer": chat_customer},
            )
            assert staged.status_code == 200, staged.text
            preview = staged.json()
            assert preview["status"] == "pending"
            assert preview["confirmation_token"]
            chat_confirmed = await client.post(
                f"/api/v1/chat/staged-actions/{preview['action_id']}/confirm",
                headers={"Idempotency-Key": "accept-chat-confirm"},
                json={"confirmation_token": preview["confirmation_token"]},
            )
            assert chat_confirmed.status_code == 200, chat_confirmed.text
            assert chat_confirmed.json()["status"] == "consumed"

            assert (await client.get("/api/v1/customers")).status_code == 200
            assert (await client.get("/api/v1/imports")).status_code == 200
            assert (await client.get("/api/v1/campaigns")).status_code == 200

    with factory() as session:
        assert session.scalar(select(Customer).where(Customer.customer_id == "ACCEPT-HIGH"))
        assert session.scalar(select(Customer).where(Customer.customer_id == "ACCEPT-LOW"))
        assert session.scalar(select(Customer).where(Customer.customer_id == "ACCEPT-CHAT"))
        assert session.scalar(select(CampaignSelection))
        assert session.scalar(select(Prediction).where(Prediction.source == "chat"))
