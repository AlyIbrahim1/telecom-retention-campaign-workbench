.PHONY: start stop migrate migrate-down test test-backend test-frontend test-migrations

start:
	docker compose up --build

stop:
	docker compose down

migrate:
	docker compose run --rm api alembic -c backend/alembic.ini upgrade head

migrate-down:
	docker compose run --rm api alembic -c backend/alembic.ini downgrade -1

test: test-backend test-frontend test-migrations

test-backend:
	docker compose run --rm --no-deps -e APP_ENV=test -e AUTH_ENABLED=false -e DATABASE_URL=postgresql+psycopg://test:test@localhost/test api pytest -q

test-frontend:
	docker compose run --rm --no-deps frontend npm test
	docker compose run --rm --no-deps frontend npm run build

test-migrations:
	docker compose -p retention-workbench-tests -f compose.test.yaml run --rm migration-test
	docker compose -p retention-workbench-tests -f compose.test.yaml down
