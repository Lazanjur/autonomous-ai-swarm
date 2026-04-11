install-web:
	cd apps/web && npm install

install-api:
	cd apps/api && pip install -e .[dev]

dev-web:
	cd apps/web && npm run dev

dev-api:
	cd apps/api && uvicorn app.main:app --reload

test-api:
	cd apps/api && pytest

lint-web:
	cd apps/web && npm run lint

compose-up:
	docker compose up --build

compose-prod-up:
	docker compose --env-file .env.production -f docker-compose.prod.yml up --build -d

compose-prod-logs:
	docker compose --env-file .env.production -f docker-compose.prod.yml logs -f
