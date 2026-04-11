# Internet Deployment

This repository now includes a production deployment path for a public domain.

## Recommended topology

- one Linux VM
- Docker Engine + Docker Compose
- Caddy for HTTPS and reverse proxy
- local PostgreSQL, Redis, and MinIO via Docker

This is the simplest reliable first deployment for the current app shape because it keeps the browser app, API, vector database, scheduler, artifact storage, and Playwright runtime together on one host.

## Included production assets

- `docker-compose.prod.yml`
- `.env.production.example`
- `infrastructure/caddy/Caddyfile`
- `/api/health` in the web app
- `/api/v1/health/ready` in the API

## DNS and host setup

1. Provision a Linux VM that can comfortably run the web app, API, PostgreSQL, Redis, MinIO, and Playwright workloads together.
2. Point your domain A record to that VM.
3. Open inbound ports `80` and `443`.
4. Install Docker and the Docker Compose plugin.

## Environment setup

1. Copy `.env.production.example` to `.env.production`.
2. Fill in:
   - `APP_DOMAIN`
   - `ACME_EMAIL`
   - `ALIBABA_API_KEY`
   - `SECRET_KEY`
   - `POSTGRES_PASSWORD`
   - `MINIO_SECRET_KEY`
3. Keep these production settings:
   - `APP_ENV=production`
   - `ENABLE_DEMO_MODE=false`
   - `ALLOW_LOCAL_PROVIDER_FALLBACK=false`
   - `AUTO_CREATE_TABLES=false`

## Launch

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up --build -d
```

## Public routes

- Homepage: `https://your-domain`
- App: `https://your-domain/app`
- API docs: `https://your-domain/docs`
- Liveness: `https://your-domain/healthz`
- Readiness: `https://your-domain/readyz`

## Notes

- The web app talks to the API through `INTERNAL_API_URL`, so the browser does not need direct access to the internal container network.
- Caddy automatically provisions TLS certificates once DNS is pointing correctly and ports `80/443` are reachable.
- The production compose file runs `alembic upgrade head` before starting the API server.
- If you later move PostgreSQL, Redis, or object storage to managed services, replace the connection env vars and remove those containers from `docker-compose.prod.yml`.
