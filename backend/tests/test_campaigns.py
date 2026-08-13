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
from backend.app.db.models import Campaign, CampaignRecommendation, CampaignSelection, Customer, OutreachDecision, Prediction
from backend.app.domain.campaigns import _percentile_rank_map, apply_override, campaign_priority, confirm_campaign, optimize_campaign, percentile_rank
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


def test_percentile_rank_map_matches_average_rank_formula():
    population = [20, 10, 10, 30, 30, 30]
    ranks = _percentile_rank_map(population)
    assert ranks == {10.0: percentile_rank(10, population), 20.0: percentile_rank(20, population), 30.0: percentile_rank(30, population)}
    assert _percentile_rank_map([]) == {}
    assert _percentile_rank_map([10]) == {10.0: 0.5}


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
    rows = list(session.scalars(select(CampaignRecommendation).where(CampaignRecommendation.optimization_run_id == run.id)))
    assert run.formula_version == "risk-spend-v1"
    assert run.recommended_count == 1
    assert sum(row.recommended for row in rows) == 1
    assert rows[0].priority_score >= rows[1].priority_score
    session.close()


def test_identical_optimization_runs_have_identical_ranks_for_same_snapshot():
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    session = factory()
    _add_prediction(session, _customer("C-1", 20, 20), 0.9)
    _add_prediction(session, _customer("C-2", 80, 600), 0.8)
    _add_prediction(session, _customer("C-3", 50, 300), 0.7)
    first = Campaign(name="First", capacity=2, status="draft", version=1)
    second = Campaign(name="Second", capacity=2, status="draft", version=1)
    session.add_all([first, second]); session.commit()
    run_one = optimize_campaign(session, first)
    # A second campaign sees the same current customer/prediction snapshot.
    run_two = optimize_campaign(session, second)
    rows_one = list(session.scalars(select(CampaignRecommendation).where(CampaignRecommendation.optimization_run_id == run_one.id).order_by(CampaignRecommendation.rank)))
    rows_two = list(session.scalars(select(CampaignRecommendation).where(CampaignRecommendation.optimization_run_id == run_two.id).order_by(CampaignRecommendation.rank)))
    assert [(row.customer_id, row.rank, float(row.priority_score)) for row in rows_one] == [(row.customer_id, row.rank, float(row.priority_score)) for row in rows_two]


def test_full_capacity_include_requires_replacement_and_persists_final_selection_snapshot():
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    session = factory()
    _add_prediction(session, _customer("C-1", 20, 20), 0.9)
    _add_prediction(session, _customer("C-2", 80, 600), 0.8)
    _add_prediction(session, _customer("C-3", 50, 300), 0.4)
    campaign = Campaign(name="Override campaign", capacity=1, status="draft", version=1)
    session.add(campaign); session.commit()
    run = optimize_campaign(session, campaign)
    session.commit()
    rows = list(session.scalars(select(CampaignRecommendation).where(CampaignRecommendation.optimization_run_id == run.id)))
    recommended = next(row for row in rows if row.recommended)
    below = next(row for row in rows if not row.recommended)
    override = apply_override(session, campaign, customer_id=below.customer_id, action="include", reason="Approved exception", replacement_customer_id=recommended.customer_id)
    assert override.replacement_customer_id == recommended.customer_id
    confirm_campaign(session, campaign)
    session.commit()
    selections = list(session.scalars(select(CampaignSelection).where(CampaignSelection.campaign_id == campaign.id)))
    decisions = list(session.scalars(select(OutreachDecision).where(OutreachDecision.campaign_id == campaign.id)))
    assert campaign.status == "confirmed"
    assert [item.customer_id for item in selections] == [below.customer_id]
    assert len(decisions) == len(rows)
    assert sum(item.decision == "selected" for item in decisions) == 1
    assert selections[0].formula_version == run.formula_version
    session.close()


def test_confirmation_selection_and_decisions_are_immutable_on_customer_rescore_and_replay():
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    session = factory()
    _add_prediction(session, _customer("C-1", 20, 20), 0.9)
    _add_prediction(session, _customer("C-2", 80, 600), 0.8)
    campaign = Campaign(name="Immutable campaign", capacity=1, status="draft", version=1)
    session.add(campaign); session.commit()
    run = optimize_campaign(session, campaign)
    session.commit()
    confirm_campaign(session, campaign)
    session.commit()
    selection = session.scalar(select(CampaignSelection).where(CampaignSelection.campaign_id == campaign.id))
    assert selection is not None
    snapshot = (selection.customer_id, selection.prediction_id, float(selection.priority_score), selection.created_at)
    customer = session.scalar(select(Customer).where(Customer.customer_id == selection.customer_id))
    assert customer is not None
    customer.monthly_charges = float(customer.monthly_charges) + 10
    session.commit()
    session.expire_all()
    selection = session.scalar(select(CampaignSelection).where(CampaignSelection.campaign_id == campaign.id))
    assert selection is not None
    assert (selection.customer_id, selection.prediction_id, float(selection.priority_score), selection.created_at) == snapshot
    assert session.scalar(select(OutreachDecision).where(OutreachDecision.campaign_id == campaign.id, OutreachDecision.decision == "selected")) is not None
    decision = session.scalar(select(OutreachDecision).where(OutreachDecision.campaign_id == campaign.id, OutreachDecision.decision == "selected"))
    assert decision is not None
    decision.reason = "changed"
    try:
        session.commit()
    except ValueError as exc:
        assert "immutable" in str(exc).lower()
        session.rollback()
    else:
        raise AssertionError("Outreach decisions must be immutable")
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
            blank_update = await client.patch(f"/api/v1/campaigns/{first.json()['campaign_id']}", headers={"If-Match": "1"}, json={"name": "   ", "capacity": 1})
            return missing, first, replay, blank_update

    missing, first, replay, blank_update = asyncio.run(calls())
    assert missing.status_code == 400
    assert first.status_code == 201, first.text
    assert replay.status_code == 201
    assert replay.json()["campaign_id"] == first.json()["campaign_id"]
    assert blank_update.status_code == 422


def test_campaign_list_summary_includes_latest_run_and_selection_counts():
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    session = factory()
    _add_prediction(session, _customer("C-1", 20, 20), 0.9)
    _add_prediction(session, _customer("C-2", 80, 600), 0.8)
    campaign = Campaign(name="Summary campaign", capacity=1, status="draft", version=1)
    session.add(campaign); session.commit()
    optimize_campaign(session, campaign)
    session.commit()
    campaign_id = campaign.id
    confirm_campaign(session, campaign)
    session.commit()
    settings = Settings(_env_file=None, app_env="test", database_url="postgresql+psycopg://test:test@localhost/test")
    app = create_app(settings=settings, database_check=lambda: True, session_factory=factory)

    async def call_list():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            return await client.get("/api/v1/campaigns")

    response = asyncio.run(call_list())
    assert response.status_code == 200, response.text
    item = next(item for item in response.json()["items"] if item["campaign_id"] == str(campaign_id))
    assert item["eligible_count"] == 2
    assert item["recommended_count"] == 1
    assert item["selected_count"] == 1
    assert item["unused_capacity"] == 0


def test_confirmation_route_replays_without_duplicate_selection_or_decision_rows():
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    setup = factory()
    _add_prediction(setup, _customer("C-1", 20, 20), 0.9)
    _add_prediction(setup, _customer("C-2", 80, 600), 0.8)
    campaign = Campaign(name="Replay campaign", capacity=1, status="draft", version=1)
    setup.add(campaign); setup.commit(); campaign_id = campaign.id
    setup.close()
    settings = Settings(_env_file=None, app_env="test", database_url="postgresql+psycopg://test:test@localhost/test")
    app = create_app(settings=settings, database_check=lambda: True, session_factory=factory)

    async def calls():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            optimized = await client.post(f"/api/v1/campaigns/{campaign_id}/optimize", headers={"If-Match": "1"}, json={})
            confirmed = await client.post(f"/api/v1/campaigns/{campaign_id}/confirm", headers={"If-Match": "2", "Idempotency-Key": "confirm-key"})
            replay = await client.post(f"/api/v1/campaigns/{campaign_id}/confirm", headers={"If-Match": "2", "Idempotency-Key": "confirm-key"})
            return optimized, confirmed, replay

    optimized, confirmed, replay = asyncio.run(calls())
    assert optimized.status_code == 200, optimized.text
    assert confirmed.status_code == 200, confirmed.text
    assert replay.status_code == 200, replay.text
    assert replay.json() == confirmed.json()
    session = factory()
    assert session.scalar(select(CampaignSelection).where(CampaignSelection.campaign_id == campaign_id)) is not None
    assert len(list(session.scalars(select(OutreachDecision).where(OutreachDecision.campaign_id == campaign_id)))) == 2
    session.close()
