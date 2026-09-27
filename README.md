# Retention Campaign Workbench

Churn scores are useful only when they lead to a better conversation with the
right customer. This project turns a telecom churn ML model into a small, local
workspace for doing exactly that: review customer risk, bring in new records,
build a capacity-aware retention campaign, and keep the final decision with a
person.

It is deliberately built as an assistant. The model suggests where to look; it does
not make outreach decisions or claim to predict the future with certainty.

This project is not a production ready application, only an educational project for learning AI and Machine learning.


## What you can do

- Review customers and their churn-risk history.
- Create or update individual customer records and score them with the bundled
  Random Forest model.
- Import CSV files through a preflight-and-confirm flow, so bad rows can be
  caught before anything is written.
- Build a limited-capacity retention campaign. Customers are ranked using churn
  risk and relative monthly and historical spend; recommendations can be
  reviewed and overridden before confirmation.
- Optionally use the chat workspace for customer lookup and **staged**
  single-customer writes. Every write has a structured preview, confirmation
  token, and idempotency key.

## How it works

```text
Customer record or CSV
        |
        v
Validation + trusted model scoring
        |
        v
Customer review and campaign ranking
        |
        v
Human review, optional override, confirmation
```

The API verifies the bundled model's checksum before loading it, stores
prediction history, and treats confirmed campaign selections as immutable.
Campaign ranking is deterministic: it combines each customer's risk score with
percentile-based monthly and historical spend, making the recommendation easier
to inspect and reproduce.

## Stack

- **Frontend:** React, TypeScript, Vite, TanStack Query
- **API:** FastAPI, SQLAlchemy, Alembic
- **Database:** PostgreSQL 16
- **Model:** scikit-learn Random Forest bundle, served through a validated
  inference layer
- **Local environment:** Docker Compose

## Run it locally

You will need Docker Desktop (or Docker Engine with Compose) and `make`.

1. Create your local settings file:

   ```bash
   cp .env.example .env
   ```

2. In `.env`, replace each `replace-with-a-local-password` value with the same
   private development password.

3. Build and start the services:

   ```bash
   make start
   ```

4. In a second terminal, apply the database migrations:

   ```bash
   make migrate
   ```

5. Open the workbench at <http://127.0.0.1:5173>.

The API health checks are available at
<http://127.0.0.1:8000/health/live> and
<http://127.0.0.1:8000/health/ready>. All service ports are bound to
`127.0.0.1` by default.

To add a small set of demo data from the IBM telecom churn database after startup, run:

```bash
make seed-demo
```

To stop the services without deleting your local database:

```bash
make stop
```

## Optional chat

The rest of the workbench works without an API key. To enable chat, set
`OPENAI_API_KEY` in `.env` and restart the API. For OpenRouter, also set
`OPENAI_BASE_URL=https://openrouter.ai/api/v1` and choose an OpenRouter model,
for example `OPENAI_MODEL=openai/gpt-4o-mini`. When it is not configured, the
chat area reports that safely and the customer, import, and campaign workflows
remain available.

## Tests

Run the full backend, frontend, build, accessibility, and disposable migration
checks with:

```bash
make test
```

For faster checks in an already configured environment:

```bash
pytest -q
npm --prefix frontend test
npm --prefix frontend run build
```

## Project layout

- `backend/` — FastAPI service, database models, migrations, and API tests.
- `frontend/` — React application for customer, import, campaign, and chat
  workflows.
- `app/` — small reference CLI for using the exported churn model directly.
- `models/` — the trusted, exported Joblib model bundle mounted read-only by
  the API.
- `scripts/seed_demo.py` — optional local demo-data seeder.
- `teleco_churn_eda.ipynb` — exploratory analysis and model-training source of
  truth.
