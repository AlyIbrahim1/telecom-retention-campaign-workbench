"""Focused CSV boundary tests."""

from __future__ import annotations

import csv
import io
import asyncio
import time

import httpx

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.app.core.config import Settings
from backend.app.db.base import Base
from backend.app.domain.imports import TEMPLATE_COLUMNS, _parse_csv, safe_export_cell, template_csv
from backend.app.db.models import Customer, Prediction
from backend.app.main import create_app
from backend.app.ml.service import TrustedModelLoader
from backend.tests.conftest import SyncASGIClient


def _content(*rows: list[str]) -> bytes:
    output = io.StringIO(newline="")
    writer = csv.writer(output, lineterminator="\n")
    writer.writerow(TEMPLATE_COLUMNS)
    writer.writerows(rows)
    return output.getvalue().encode()


def _row(customer_id: str = "IMP-001") -> list[str]:
    values = {
        "customerID": customer_id,
        "gender": "Female",
        "SeniorCitizen": "0",
        "Partner": "Yes",
        "Dependents": "No",
        "tenure": "3",
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
        "MonthlyCharges": "89.5",
        "TotalCharges": "268.5",
    }
    return [values[column] for column in TEMPLATE_COLUMNS]


def _client():
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    settings = Settings(_env_file=None, app_env="test", database_url="postgresql+psycopg://test:test@localhost/test")
    app = create_app(settings=settings, database_check=lambda: True, session_factory=factory)
    return TestClient(app, raise_server_exceptions=False), engine


def test_template_and_snake_case_mapping_accept_both_heading_styles():
    assert b"customerID" in template_csv()
    settings = Settings(_env_file=None, app_env="test", database_url="postgresql+psycopg://test:test@localhost/test")
    parsed = _parse_csv(_content(*[_row()]), settings)
    assert parsed.missing_columns == []
    assert parsed.mappings["customerID"] == "customer_id"

    snake_header = [
        "customer_id", "gender", "senior_citizen", "partner", "dependents", "tenure",
        "phone_service", "multiple_lines", "internet_service", "online_security", "online_backup",
        "device_protection", "tech_support", "streaming_tv", "streaming_movies", "contract",
        "paperless_billing", "payment_method", "monthly_charges", "total_charges",
    ]
    text = io.StringIO(newline="")
    writer = csv.writer(text, lineterminator="\n")
    writer.writerow(snake_header)
    writer.writerow(_row())
    parsed_snake = _parse_csv(text.getvalue().encode(), settings)
    assert parsed_snake.missing_columns == []


def test_parser_rejects_empty_and_limits():
    settings = Settings(_env_file=None, app_env="test", database_url="postgresql+psycopg://test:test@localhost/test", import_max_rows=1)
    try:
        _parse_csv(b"customerID\n", settings)
    except ValueError as exc:
        assert "at least one data row" in str(exc)
    else:
        raise AssertionError("header-only CSV should be rejected")
    try:
        _parse_csv(_content(*[_row("A"), _row("B")]), settings)
    except ValueError as exc:
        assert "row limit" in str(exc)
    else:
        raise AssertionError("oversized row count should be rejected")


def test_preflight_writes_job_but_no_customer_and_duplicate_is_reported():
    _client_obj, engine = _client()
    # ASGITransport avoids a Starlette TestClient worker-thread deadlock on
    # this repository's WSL/SQLite combination while exercising real routing.
    app = _client_obj.app
    content = _content(*[_row("IMP-001"), _row("IMP-001")])
    async def post(payload: bytes):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            return await client.post("/api/v1/imports/preflight?mode=create", files={"file": ("customers.csv", payload, "text/csv")})
    response = asyncio.run(post(content))
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["invalid_rows"] == 2
    assert body["duplicate_customer_ids"] == ["IMP-001"]
    assert body["proposed_idempotency_key"]
    with engine.connect() as connection:
        assert connection.exec_driver_sql("SELECT count(*) FROM customers").scalar() == 0
        assert connection.exec_driver_sql("SELECT count(*) FROM import_jobs").scalar() == 1
    response = asyncio.run(post(_content(_row("IMP-002"))))
    assert response.status_code == 409
    assert response.json()["code"] == "import_already_active"


def test_formula_cells_are_neutralized_for_exports():
    assert safe_export_cell("=SUM(A1)") == "'=SUM(A1)"
    assert safe_export_cell("normal") == "normal"


def test_import_list_accepts_documented_query_string_page_size():
    client, _engine = _client()

    async def calls():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=client.app),
            base_url="http://test",
        ) as async_client:
            response = await async_client.get("/api/v1/imports?page=1&page_size=25")
            invalid = await async_client.get("/api/v1/imports?page=1&page_size=30")
            return response, invalid

    response, invalid = asyncio.run(calls())
    assert response.status_code == 200, response.text
    assert response.json()["page_size"] == 25
    assert invalid.status_code == 422
    assert invalid.json()["code"] == "validation_failed"


def test_confirm_is_replay_safe_and_persists_one_prediction():
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
        session_factory=factory,
        model_loader=TrustedModelLoader(settings.model_path, settings.model_sha256),
    )
    content = _content(_row("IMP-REPLAY"))
    with SyncASGIClient(app) as client:
        preflight = client.post(
            "/api/v1/imports/preflight?mode=create",
            files={"file": ("customers.csv", content, "text/csv")},
        )
        assert preflight.status_code == 200
        job_id = preflight.json()["job_id"]
        confirmed = client.post(
            f"/api/v1/imports/{job_id}/confirm",
            headers={"Idempotency-Key": "import-confirm"},
        )
        replay = client.post(
            f"/api/v1/imports/{job_id}/confirm",
            headers={"Idempotency-Key": "import-confirm"},
        )
        deadline = time.monotonic() + 10
        while replay.json()["status"] in {"queued", "running"} and time.monotonic() < deadline:
            time.sleep(0.05)
            replay = client.post(
                f"/api/v1/imports/{job_id}/confirm",
                headers={"Idempotency-Key": "import-confirm"},
            )
        assert confirmed.status_code == replay.status_code == 200
        assert confirmed.json()["status"] == "queued"
        assert replay.json()["status"] == "completed"
        assert replay.json()["succeeded_rows"] == 1
        assert client.get(f"/api/v1/imports/{job_id}/results").status_code == 200
        assert client.get(f"/api/v1/imports/{job_id}/errors").status_code == 200
    with factory() as session:
        assert len(session.scalars(select(Customer)).all()) == 1
        assert len(session.scalars(select(Prediction)).all()) == 1


def test_import_persists_zero_tenure_normalization_warning():
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
        session_factory=factory,
        model_loader=TrustedModelLoader(settings.model_path, settings.model_sha256),
    )
    row = _row("IMP-ZERO")
    row[TEMPLATE_COLUMNS.index("tenure")] = "0"
    row[TEMPLATE_COLUMNS.index("TotalCharges")] = ""
    with SyncASGIClient(app) as client:
        uploaded = client.post(
            "/api/v1/imports?mode=create",
            files={"file": ("customers.csv", _content(row), "text/csv")},
            headers={"Idempotency-Key": "import-zero-tenure"},
        )
        assert uploaded.status_code == 202
        deadline = time.monotonic() + 10
        job = client.get(f"/api/v1/imports/{uploaded.json()['job_id']}").json()
        while job["status"] in {"queued", "running"} and time.monotonic() < deadline:
            time.sleep(0.05)
            job = client.get(f"/api/v1/imports/{uploaded.json()['job_id']}").json()
        assert job["status"] == "completed"
        assert job["succeeded_rows"] == 1
        assert job["rows"][0]["warnings"][0]["field"] == "total_charges"
