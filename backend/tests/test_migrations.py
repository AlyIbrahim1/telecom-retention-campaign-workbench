"""Disposable PostgreSQL migration round-trip used by the Compose test gate."""

import os
from uuid import uuid4

import psycopg
import pytest
from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from psycopg import sql
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import make_url


ADMIN_URL = os.getenv("TEST_DATABASE_ADMIN_URL")


@pytest.mark.skipif(not ADMIN_URL, reason="requires disposable PostgreSQL access")
def test_fresh_postgresql_migration_up_down_up(monkeypatch):
    database_name = f"migration_{uuid4().hex}"
    admin_url = make_url(ADMIN_URL)
    target_url = admin_url.set(
        drivername="postgresql+psycopg", database=database_name
    )

    with psycopg.connect(ADMIN_URL, autocommit=True) as connection:
        connection.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(database_name)))

    engine = create_engine(target_url)
    try:
        monkeypatch.setenv("DATABASE_URL", target_url.render_as_string(hide_password=False))
        alembic = Config("backend/alembic.ini")
        command.upgrade(alembic, "0005_phase6")
        with engine.begin() as connection:
            connection.execute(
                text("INSERT INTO campaigns (id, name, capacity, status, version, created_at, updated_at) "
                     "VALUES (:id, 'Existing campaign', 2, 'draft', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"),
                {"id": uuid4()},
            )
        command.upgrade(alembic, "head")
        with engine.connect() as connection:
            assert connection.scalar(text("SELECT version_num FROM alembic_version")) == ScriptDirectory.from_config(alembic).get_current_head()
            assert connection.execute(text("SELECT value_horizon_months, contact_cost_per_customer FROM campaigns WHERE name = 'Existing campaign'")).one() == (3, 5)

        command.downgrade(alembic, "base")
        with engine.connect() as connection:
            assert connection.scalar(text("SELECT count(*) FROM alembic_version")) == 0

        command.upgrade(alembic, "head")
        tables = set(inspect(engine).get_table_names())
        assert {
            "customers",
            "predictions",
            "import_jobs",
            "import_row_outcomes",
            "campaigns",
            "optimization_runs",
            "campaign_recommendations",
            "campaign_selections",
            "campaign_overrides",
            "outreach_decisions",
            "outreach_events",
            "chat_sessions",
            "chat_messages",
            "chat_tool_audits",
            "chat_staged_actions",
        } <= tables
    finally:
        engine.dispose()
        with psycopg.connect(ADMIN_URL, autocommit=True) as connection:
            connection.execute(
                "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
                "WHERE datname = %s AND pid <> pg_backend_pid()",
                (database_name,),
            )
            connection.execute(
                sql.SQL("DROP DATABASE {}").format(sql.Identifier(database_name))
            )
