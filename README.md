# Retention Campaign Workbench

A beginner-friendly local workspace for reviewing telecom churn model scores,
preparing human-confirmed retention campaigns, and using optional chat-assisted
customer lookup and confirmed single-customer writes.

> **PILOT — SAMPLE OR APPROVED TEST DATA ONLY.** The application has no
> authentication. Do not expose it publicly or use real production customer
> data. A risk score is a model ranking score, not a calibrated probability.

The workspace provides validated customer and prediction records, import jobs,
campaign optimization and review, and optional chat at `/chat`. Chat writes
always show a structured preview and require a one-time confirmation token plus
an idempotency key. Without `OPENAI_API_KEY`, chat reports a safe unavailable
state while the rest of the workspace remains usable.

## Prerequisites

- Docker Desktop or Docker Engine with Compose.
- `make` for the short commands below, or the equivalent Compose commands.

The existing `.venv` remains the notebook environment. Docker uses the separate
backend dependency lock and frontend npm lock.

## First local start

1. Copy `.env.example` to `.env`.
2. Replace every `replace-with-a-local-password` value in `.env` with the same
   private development password.
3. Start the services with `make start`.
4. In another terminal, apply migrations with `make migrate`.
5. Open <http://127.0.0.1:5173>. API liveness and readiness are available at
   <http://127.0.0.1:8000/health/live> and
   <http://127.0.0.1:8000/health/ready>.

Frontend, API, and PostgreSQL ports are published only on `127.0.0.1`.

## Stop safely

```bash
make stop
```

This stops containers but preserves the named PostgreSQL development volume.
Do not add `--volumes` unless you deliberately intend to erase local database
data.

## Migrations and tests

Apply all migrations with `make migrate`; revert the most recent migration with
`make migrate-down`.

Run all backend, frontend, accessibility, build, and disposable PostgreSQL
migration checks with:

```bash
make test
```

For quicker installed-environment checks during development:

```bash
pytest -q
npm --prefix frontend test
npm --prefix frontend run build
```

## Repository guide

- `teleco_churn_eda.ipynb` — analysis and model-training source of truth.
- `app/` — reference inference CLI.
- `backend/` — FastAPI service, database, migrations, and tests.
- `frontend/` — React customer, import, campaign, and chat workflows.
- `models/` — trusted exported Joblib bundle, mounted read-only in the API.
