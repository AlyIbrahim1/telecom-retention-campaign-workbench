# Retention Campaign Workbench

A beginner-friendly local pilot for reviewing telecom churn model scores,
preparing human-confirmed retention campaigns, and using an optional grounded
assistant for fact lookup and confirmed single-customer writes.

> **PILOT — SAMPLE OR APPROVED TEST DATA ONLY.** The application has no
> authentication. Do not expose it publicly or use real production customer
> data. A risk score is a model ranking score, not a calibrated probability.

 adds the trustworthy customer/prediction core: strict canonical
validation, atomic create/update-and-score routes, immutable prediction
snapshots, audit history, idempotency, optimistic update versions, and startup
verification for the read-only model bundle.  adds the customer list,
detail/history view, and explicit create/update forms with preview-before-save.
 adds bounded CSV template, preflight, confirmation, progress,
partial-success, cancellation, and formula-safe result/error exports.
 adds campaign drafts, deterministic `risk-spend-v1` optimization
snapshots, explainable value/priority rows, reasoned overrides, explicit
confirmation, and archive lifecycle. Priority is a spending-derived review
proxy, not a probability, guaranteed profit, or automatic outreach action.
 adds the optional grounded assistant at `/chat`. It can retrieve one
customer or campaign at a time, explain stored model/formula outputs, and stage
one complete customer create/update. Chat writes always show a structured
preview and require a one-time confirmation token plus idempotency key; no
campaign confirmation or external outreach is available. Without
`OPENAI_API_KEY`, chat reports a safe unavailable state while the rest of the
workspace remains usable.

## Prerequisites

- Docker Desktop or Docker Engine with Compose.
- `make` for the short commands below, or use the equivalent Compose commands.

The existing `.venv` remains the notebook environment. Docker uses the separate
backend dependency lock and frontend npm lock. Backend direct requirements live
in `backend/requirements.in`; `backend/requirements.lock` freezes their complete
resolved dependency graph for Python 3.12 on Linux.

## First local start

1. Copy `.env.example` to `.env`.
2. Replace every `replace-with-a-local-password` value in `.env` with the same
   private development password.
3. Start the three services:

   ```bash
   make start
   ```

4. In another terminal, apply migrations:

   ```bash
   make migrate
   ```

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

## Migrations

Apply all migrations:

```bash
make migrate
```

Revert the most recent migration without deleting the database volume:

```bash
make migrate-down
```

The  revision is intentionally empty;  introduces domain tables,
 adds imports,  adds campaign snapshots, and  adds bounded
chat sessions, tool audit metadata, and staged actions.

/3/4/5 API routes are available under `/api/v1`: `GET /customers` provides
bounded server-side search, filters, stable sorting, and 25/50/100-row
pagination; `POST /customers/preview`, `POST /customers`,
`GET /customers/{customer_id}`, explicit update preview and update routes,
prediction history, audit history, model metadata, and the canonical customer
schema are also available. Create/update writes require an `Idempotency-Key`;
updates also require `If-Match` with the current integer version. Import routes
include `GET /imports/template`, `POST /imports/preflight`, `GET /imports`,
`GET /imports/{job_id}`, explicit `POST /imports/{job_id}/confirm` and
`/cancel`, and result/error CSV downloads. Import mode is always explicit:
`create` rejects existing IDs and `update` rejects missing IDs; mixed upsert is
not supported. Campaign routes provide draft creation/editing, deterministic
optimization, ranked snapshot review, human overrides, confirmation, and
archiving.

## Tests

Run all accumulated backend, frontend, accessibility, build, and disposable
PostgreSQL migration checks:

```bash
make test
```

The migration test creates a uniquely named disposable database, runs
`upgrade -> downgrade -> upgrade`, and drops it afterward. It never uses the
persistent development database.

For quicker installed-environment checks during development:

```bash
pytest -q
npm --prefix frontend test
npm --prefix frontend run build
```

 evidence and the checks that still require Docker/PostgreSQL or a
browser-runner are recorded in [release-checklist.md](release-checklist.md).

## Configuration boundary

Settings are documented in `.env.example`. `DATABASE_URL` is required, the
frontend origin must be exact, and `AUTH_ENABLED=true`, `APP_ENV=staging`, or
`APP_ENV=production` refuses startup because authentication is not implemented.
Secrets stay backend-only and `.env` is ignored by Git.

## How the /3 foundation works

The browser starts at `frontend/src/main.tsx`. React Router chooses a page,
while TanStack Query calls `/health/ready` before a feature page is shown.
During that check the persistent application shell remains visible. A failed
or non-ready response becomes a safe retry screen; raw network errors are
never displayed. The  customer pages keep list filters, form values,
preview state, duplicate-ID guidance, and optimistic-version conflicts visible
to the operator. Unknown URLs use the same shell and a clear 404 page.

The API starts through `backend.app.main:create_app`. Typed Pydantic settings
reject unsafe deployment modes before serving traffic. Each HTTP request then
passes through one boundary middleware that:

1. generates a correlation ID;
2. rejects declared or streamed bodies above the configured limit;
3. adds the security headers to success and error responses; and
4. writes one JSON log entry containing only method, path, status, duration,
   and correlation ID.

FastAPI turns known HTTP and validation failures into stable RFC 7807-style
problems. Unexpected failures receive a generic message, never the exception.
`/health/live` proves only that the process runs. `/health/ready` separately
executes `SELECT 1` and reports trusted model readiness, so a database or model
outage makes readiness fail without making liveness fail.

Alembic tracks database revisions. The first revision contains no application
tables because those belong to ; it establishes a reversible baseline
without guessing the customer data model early.

## Repository guide

- `teleco_churn_eda.ipynb` — analysis and model-training source of truth.
- `app/` —  reference inference CLI; kept unchanged until .
- `backend/` — FastAPI, settings, safety middleware, database, migrations, tests.
- `frontend/` — accessible React shell, customer/import/campaign workflows, and the optional  assistant.
- `` — approved product plan, contracts, stages, and model evidence.
- `models/` — trusted exported Joblib bundle; mounted read-only in the API.
