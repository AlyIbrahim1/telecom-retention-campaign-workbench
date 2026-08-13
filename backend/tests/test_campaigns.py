""" deterministic formula and lifecycle tests."""

from __future__ import annotations

import asyncio
import hashlib
import json
from datetime import UTC, datetime

import httpx
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from backend.app.core.config import Settings
from backend.app.db.base import Base
from backend.app.db.models import Campaign, Customer, Prediction
from backend.app.domain.campaigns import campaign_priority, optimize_campaign, percentile_rank
from backend.app.main import create_app
from backend.app.schemas.customer import CustomerInput


def test_percentile_formula_boundaries_and_ties():
    assert percentile_rank(1, []) == 0
    assert percentile_rank(10, [10]) == 0.5
    assert percentile_rank(10, [10, 10, 10]) == 0.5
    assert percentile_rank(10, [0, 10, 20]) == 0.5
    assert percentile_rank(0, [0, 10, 20]) == 0
    assert percentile_rank(20, [0, 10, 20]) == 1
    value, priority = campaign_priority(0.8, 0.5, 1.0)
    assert value == 0.7
    assert priority == 56.0


def _customer(customer_id: str, monthly: float, total: float) -> Customer:
    return Customer(
        customer_id=customer_id, gender="Female", senior_citizen="No", partner="Yes", dependents="No", tenure=3,
        phone_service="Yes", multiple_lines="No", internet_service="Fiber optic", online_security="No", online_backup="No",
        device_protection="No", tech_support="No", streaming_tv="Yes", streaming_movies="Yes", contract="Month-to-month",
        paperless_billing="Yes", payment_method="Electronic check", monthly_charges=monthly, total_charges=total, source="form",
    )


def _add_prediction(session, customer: Customer, score: float):
    session.add(customer); session.flush()
    snapshot = CustomerInput.model_validate(customer.as_input_dict()).model_dump(mode="json")
    session.add(Prediction(customer_uuid=customer.id, customer_id=customer.customer_id, input_snapshot=snapshot, input_hash=hashlib.sha256(json.dumps(snapshot, sort_keys=True, separators=(",", ":")).encode()).hexdigest(), risk_score=score, recommended_for_review=score >= 0.5, model_version="random-forest-bundle-v1", model_sha256="a" * 64, threshold=0.5, threshold_policy_version="fpr-cap-0.31-v1", scored_at=datetime.now(UTC), source="form", warnings=[], success=True))


def test_optimize_persists_immutable_ranked_snapshot_and_capacity():
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    session = factory()
    _add_prediction(session, _customer("C-LOW", 20, 20), 0.9)
    _add_prediction(session, _customer("C-HIGH", 100, 1000), 0.8)
    campaign = Campaign(name="Pilot campaign", capacity=1, status="draft", version=1)
    session.add(campaign); session.commit()
    run = optimize_campaign(session, campaign)
    session.commit()
    rows = list(session.scalars(select(__import__("backend.app.db.models", fromlist=["CampaignRecommendation"]).CampaignRecommendation).where(__import__("backend.app.db.models", fromlist=["CampaignRecommendation"]).CampaignRecommendation.optimization_run_id == run.id)))
    assert run.formula_version == "risk-spend-v1"
    assert run.recommended_count == 1
    assert sum(row.recommended for row in rows) == 1
    assert rows[0].priority_score >= rows[1].priority_score
    session.close()


def test_campaign_create_route_requires_idempotency_and_replays():
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    settings = Settings(_env_file=None, app_env="test", database_url="postgresql+psycopg://test:test@localhost/test")
    app = create_app(settings=settings, database_check=lambda: True, session_factory=factory)

    async def calls():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            missing = await client.post("/api/v1/campaigns", json={"name": "A", "capacity": 1})
            first = await client.post("/api/v1/campaigns", headers={"Idempotency-Key": "campaign-key"}, json={"name": "A", "capacity": 1})
            replay = await client.post("/api/v1/campaigns", headers={"Idempotency-Key": "campaign-key"}, json={"name": "A", "capacity": 1})
            return missing, first, replay

    missing, first, replay = asyncio.run(calls())
    assert missing.status_code == 400
    assert first.status_code == 201, first.text
    assert replay.status_code == 201
    assert replay.json()["campaign_id"] == first.json()["campaign_id"]
