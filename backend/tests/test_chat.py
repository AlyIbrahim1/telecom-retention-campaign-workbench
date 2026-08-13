""" grounded-chat and one-time customer-write evidence."""

from __future__ import annotations

import asyncio
import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import UUID

import httpx
import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from backend.app.core.config import Settings
from backend.app.db.base import Base
from backend.app.db.models import AuditEvent, Campaign, ChatStagedAction, ChatToolAudit, Customer, Prediction
from backend.app.domain.chat import execute_read_tool
from backend.app.main import create_app
from backend.app.ml.service import TrustedModelLoader
from backend.app.schemas.chat import ChatProviderResponse, ChatToolCall


ROOT = Path(__file__).resolve().parents[2]
FIXTURE = json.loads((ROOT / "tests/fixtures/model-fixtures.json").read_text())[0]["input"]
FIELD_MAP = {
    "SeniorCitizen": "senior_citizen", "Partner": "partner", "Dependents": "dependents",
    "PhoneService": "phone_service", "MultipleLines": "multiple_lines", "InternetService": "internet_service",
    "OnlineSecurity": "online_security", "OnlineBackup": "online_backup", "DeviceProtection": "device_protection",
    "TechSupport": "tech_support", "StreamingTV": "streaming_tv", "StreamingMovies": "streaming_movies",
    "Contract": "contract", "PaperlessBilling": "paperless_billing", "PaymentMethod": "payment_method",
    "MonthlyCharges": "monthly_charges", "TotalCharges": "total_charges",
}


def customer_payload(customer_id: str = "CHAT-NEW") -> dict:
    return {FIELD_MAP.get(key, key): value for key, value in FIXTURE.items() if key != "customerID"} | {"customer_id": customer_id}


class FakeProvider:
    def __init__(self, *responses: ChatProviderResponse):
        self.responses = list(responses)

    def respond(self, _messages, _tools):
        return self.responses.pop(0) if self.responses else ChatProviderResponse(text="grounded answer")


def make_app(provider=None):
    settings = Settings(_env_file=None, app_env="test", database_url="postgresql+psycopg://test:test@localhost/test")
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    app = create_app(
        settings=settings,
        database_check=lambda: True,
        model_loader=TrustedModelLoader(settings.model_path, settings.model_sha256),
        session_factory=factory,
        chat_provider=provider,
    )
    return app, factory


async def call(app, method: str, path: str, **kwargs):
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            return await getattr(client, method)(path, **kwargs)


def test_chat_without_provider_key_fails_gracefully_and_persists_no_customer_write():
    app, factory = make_app()
    session = asyncio.run(call(app, "post", "/api/v1/chat/sessions", json={}))
    assert session.json()["ai_available"] is False
    response = asyncio.run(call(app, "post", f"/api/v1/chat/sessions/{session.json()['session_id']}/messages", json={"content": "hello"}))
    assert response.status_code == 503
    assert response.json()["code"] == "ai_unavailable"
    with factory() as db:
        assert db.scalar(select(Customer).where(Customer.customer_id == "CHAT-NEW")) is None


def test_campaign_summary_tool_is_allowlisted_and_bounded():
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    with factory() as db:
        campaign = Campaign(name="Summary chat", capacity=2, status="draft", version=1)
        db.add(campaign)
        db.commit()
        result = execute_read_tool(db, "get_campaign_summary", {"campaign_id": str(campaign.id)})
    assert result["campaign_id"] == str(campaign.id)
    assert result["selected_count"] == 0


def test_chat_context_is_size_bounded():
    app, _factory = make_app(FakeProvider(ChatProviderResponse(text="ok")))
    response = asyncio.run(call(app, "post", "/api/v1/chat/sessions", json={"context": {"source": "x" * 5000}}))
    assert response.status_code == 422
    assert response.json()["code"] == "validation_failed"


def test_allowlisted_tool_reads_exact_customer_and_audits_redacted_arguments():
    provider = FakeProvider(ChatProviderResponse(tool_calls=[ChatToolCall(name="get_customer", arguments={"customer_id": "CHAT-READ"})]))
    app, factory = make_app(provider)
    # Seed through the existing validated customer write route.
    session = asyncio.run(call(app, "post", "/api/v1/chat/sessions", json={}))
    session_id = session.json()["session_id"]
    created = asyncio.run(call(app, "post", "/api/v1/customers", json=customer_payload("CHAT-READ"), headers={"Idempotency-Key": "form-1"}))
    assert created.status_code == 201
    response = asyncio.run(call(app, "post", f"/api/v1/chat/sessions/{session_id}/messages", json={"content": "show record"}))
    assert response.status_code == 200, response.text
    assert response.json()["tool_results"][0]["tool"] == "get_customer"
    assert response.json()["tool_results"][0]["result"]["customer"]["customer_id"] == "CHAT-READ"
    assert response.json()["message"]["evidence"][0]["kind"] == "customer_record"
    with factory() as db:
        audit = db.scalar(select(ChatToolAudit))
        assert audit is not None
        assert "customer_field_count" not in audit.arguments
        assert audit.arguments["customer_id"] == "CHAT-READ"


def test_chat_stage_confirm_is_one_time_and_idempotent():
    app, factory = make_app(FakeProvider(ChatProviderResponse(text="preview ready")))
    session = asyncio.run(call(app, "post", "/api/v1/chat/sessions", json={}))
    sid = session.json()["session_id"]
    staged = asyncio.run(call(app, "post", f"/api/v1/chat/sessions/{sid}/staged-actions", headers={"Idempotency-Key": "stage-1"}, json={"action": "create", "customer": customer_payload()}))
    assert staged.status_code == 200, staged.text
    preview = staged.json()
    headers = {"Idempotency-Key": "confirm-1"}
    first = asyncio.run(call(app, "post", f"/api/v1/chat/staged-actions/{preview['action_id']}/confirm", headers=headers, json={"confirmation_token": preview["confirmation_token"]}))
    replay = asyncio.run(call(app, "post", f"/api/v1/chat/staged-actions/{preview['action_id']}/confirm", headers=headers, json={"confirmation_token": preview["confirmation_token"]}))
    assert first.status_code == replay.status_code == 200
    assert first.json() == replay.json()
    with factory() as db:
        assert len(db.scalars(select(Customer).where(Customer.customer_id == "CHAT-NEW")).all()) == 1
        assert len(db.scalars(select(Prediction).where(Prediction.source == "chat")).all()) == 1
        assert db.scalar(select(AuditEvent).where(AuditEvent.source == "chat")) is not None
    consumed = asyncio.run(call(app, "post", f"/api/v1/chat/staged-actions/{preview['action_id']}/confirm", headers={"Idempotency-Key": "confirm-2"}, json={"confirmation_token": preview["confirmation_token"]}))
    assert consumed.status_code == 409
    assert consumed.json()["code"] == "staged_action_consumed"


def test_chat_update_requires_expected_version_and_rejects_stale_confirmation():
    app, factory = make_app(FakeProvider(ChatProviderResponse(text="preview ready")))
    created = asyncio.run(call(app, "post", "/api/v1/customers", json=customer_payload("CHAT-UPDATE"), headers={"Idempotency-Key": "form-2"}))
    assert created.status_code == 201
    session = asyncio.run(call(app, "post", "/api/v1/chat/sessions", json={}))
    sid = session.json()["session_id"]
    staged = asyncio.run(call(app, "post", f"/api/v1/chat/sessions/{sid}/staged-actions", json={"action": "update", "expected_version": 1, "customer": customer_payload("CHAT-UPDATE")}))
    assert staged.status_code == 200, staged.text
    with factory() as db:
        row = db.scalar(select(Customer).where(Customer.customer_id == "CHAT-UPDATE"))
        assert row is not None
        row.version = 2
        db.commit()
    preview = staged.json()
    response = asyncio.run(call(app, "post", f"/api/v1/chat/staged-actions/{preview['action_id']}/confirm", headers={"Idempotency-Key": "confirm-update"}, json={"confirmation_token": preview["confirmation_token"]}))
    assert response.status_code == 409
    assert response.json()["code"] == "customer_version_conflict"


def test_expired_confirmation_is_consumed_safely():
    app, factory = make_app(FakeProvider(ChatProviderResponse(text="preview ready")))
    session = asyncio.run(call(app, "post", "/api/v1/chat/sessions", json={}))
    staged = asyncio.run(call(app, "post", f"/api/v1/chat/sessions/{session.json()['session_id']}/staged-actions", json={"action": "create", "customer": customer_payload("CHAT-EXPIRED")}))
    preview = staged.json()
    with factory() as db:
        row = db.scalar(select(ChatStagedAction).where(ChatStagedAction.id == UUID(preview["action_id"])))
        assert row is not None
        row.expires_at = datetime.now(UTC) - timedelta(seconds=1)
        db.commit()
    response = asyncio.run(call(app, "post", f"/api/v1/chat/staged-actions/{preview['action_id']}/confirm", headers={"Idempotency-Key": "confirm-expired"}, json={"confirmation_token": preview["confirmation_token"]}))
    assert response.status_code == 410
    assert response.json()["code"] == "staged_action_expired"
    with factory() as db:
        row = db.scalar(select(ChatStagedAction).where(ChatStagedAction.id == UUID(preview["action_id"])))
        assert row is not None and row.status == "expired"
