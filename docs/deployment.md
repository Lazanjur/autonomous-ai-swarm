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
- `infrastructure/scripts/upcloud-init.sh`
- `infrastructure/scripts/validate-production-env.sh`
- `infrastructure/scripts/backup-production.sh`
- `infrastructure/scripts/check-production-posture.sh`
- `infrastructure/scripts/rotate-production-secrets.sh`
- `infrastructure/observability/prometheus.yml`
- `infrastructure/observability/alert-rules.yml`
- `infrastructure/observability/vector.yaml`
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
   - optional hardening knobs:
     - `ALERT_WEBHOOK_URL`
     - `PRODUCTION_BACKUP_MAX_AGE_HOURS`
     - `SECRET_ROTATION_INTERVAL_DAYS`
     - `SSL_MIN_VALID_DAYS`
3. Keep these production settings:
   - `APP_ENV=production`
   - `ENABLE_DEMO_MODE=false`
   - `ALLOW_LOCAL_PROVIDER_FALLBACK=false`
   - `AUTO_CREATE_TABLES=false`

## Launch

Run the preflight first:

```bash
./infrastructure/scripts/validate-production-env.sh .env.production
```

Then launch:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up --build -d
```

For UpCloud specifically, you can paste [upcloud-init.sh](C:\Users\ivkus\Documents\D450%20Python\autonomous-ai-swarm\infrastructure\scripts\upcloud-init.sh) into the server initialization script field. It installs Docker, Docker Compose, Git, UFW, Fail2ban, clones the repo into `/opt/autonomous-ai-swarm`, prepares `.env.production`, and adds helper commands:

- `swarm-deploy`
- `swarm-logs`

## Public routes

- Homepage: `https://your-domain`
- App: `https://your-domain/app`
- API docs: `https://your-domain/docs`
- Liveness: `https://your-domain/healthz`
- Readiness: `https://your-domain/readyz`

## Observability

- Prometheus is available on `127.0.0.1:9090`
- Docker log aggregation is written by Vector into the `vector-data` volume
- The API now exposes Prometheus-format metrics for internal scrapers
- Caddy blocks public access to metrics paths

## Backups and posture checks

Create a manual backup:

```bash
./infrastructure/scripts/backup-production.sh
```

Run a posture check:

```bash
./infrastructure/scripts/check-production-posture.sh
```

Recommended cron entries on the server:

```cron
17 2 * * * cd /opt/autonomous-ai-swarm && ./infrastructure/scripts/backup-production.sh >> /var/log/swarm-backup.log 2>&1
*/10 * * * * cd /opt/autonomous-ai-swarm && ./infrastructure/scripts/check-production-posture.sh >> /var/log/swarm-watchdog.log 2>&1
```

## Secret rotation discipline

Generate a fresh rotation plan:

```bash
./infrastructure/scripts/rotate-production-secrets.sh
```

Apply only app/session secrets automatically:

```bash
./infrastructure/scripts/rotate-production-secrets.sh --apply-app-only
```

Database and MinIO credentials should be rotated during a coordinated maintenance window.

## Notes

- The web app talks to the API through `INTERNAL_API_URL`, so the browser does not need direct access to the internal container network.
- Caddy automatically provisions TLS certificates once DNS is pointing correctly and ports `80/443` are reachable.
- The production compose file runs `alembic upgrade head` before starting the API server.
- The API readiness check now fails closed in production when domain, secret, demo-mode, or provider-fallback posture is invalid.
- If you later move PostgreSQL, Redis, or object storage to managed services, replace the connection env vars and remove those containers from `docker-compose.prod.yml`.
