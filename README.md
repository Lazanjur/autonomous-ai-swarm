# Autonomous AI Swarm

Autonomous AI Swarm is a monorepo for an enterprise-grade multi-agent AI platform with:

- a premium Next.js web experience,
- a FastAPI backend for orchestration, chat, RAG, tools, and automation,
- PostgreSQL + pgvector, Redis, and MinIO infrastructure,
- a supervisor-led multi-agent architecture using Alibaba-hosted Qwen models.

## Monorepo layout

- `apps/web`: Next.js marketing site and authenticated app shell
- `apps/api`: FastAPI backend, orchestration runtime, RAG, tools, persistence
- `infrastructure/docker`: container definitions and bootstrap scripts
- `docs`: architecture and operational notes

## Quick start

1. Copy `.env.example` to `.env`
2. Set `ALIBABA_API_KEY`
3. Start infrastructure and apps:

```bash
docker compose up --build
```

4. Open:

- Web: `http://localhost:3000`
- API docs: `http://localhost:8000/docs`

The public homepage is served by the Next.js marketing app at `/`, and the authenticated product lives under `/app`.

For production deployments:

- set `APP_ENV=production`
- set `ENABLE_DEMO_MODE=false`
- set `ALLOW_LOCAL_PROVIDER_FALLBACK=false`

## Internet deployment

This repository now includes a production deployment stack for a public domain:

- `docker-compose.prod.yml`
- `.env.production.example`
- `docs/deployment.md`

Quick path:

1. Copy `.env.production.example` to `.env.production`
2. Set `APP_DOMAIN`, `ACME_EMAIL`, `ALIBABA_API_KEY`, `SECRET_KEY`, `POSTGRES_PASSWORD`, and `MINIO_SECRET_KEY`
3. Point your DNS A record to the server
4. Run:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up --build -d
```

The production stack places Caddy in front of the app for HTTPS, routes `/` and `/app` to the web service, and routes `/api/v1`, `/docs`, and `/openapi.json` to the FastAPI backend.

## Demo auth

Demo auth is intended for local and non-production environments.

After startup, sign in at `http://localhost:3000/signin` with:

- email: `demo@swarm.local`
- password: `DemoPass123!`

Override these with `DEMO_USER_EMAIL`, `DEMO_USER_PASSWORD`, and the matching `NEXT_PUBLIC_*` values.

## Knowledge uploads and artifacts

- Open `http://localhost:3000/app/knowledge`
- Upload PDF, DOCX, TXT, Markdown, HTML, CSV, JSON, XLS, or XLSX files
- The backend will parse the file, normalize tags, detect duplicate document content, skip duplicate indexing by default, persist the original source file, and generate a default markdown export artifact
- Additional TXT, JSON, and Markdown exports can be generated per document from the knowledge page

## Hybrid retrieval

- Each chunk is embedded at ingestion time
- Search combines keyword overlap and embedding similarity for hybrid ranking, then reranks with trust and freshness signals
- Retrieval caps the number of chunks returned per document so one source does not dominate the result set
- Search responses now include retrieval observability so the UI can show which ranking path ran, which filters were applied, why fallback happened, and what weights and timings shaped the result
- The knowledge page also exposes a health view for embedding coverage, duplicate groups, trust averages, and tag hygiene
- If `ALLOW_LOCAL_PROVIDER_FALLBACK=true`, the backend can fall back to deterministic local embeddings so retrieval still works during development or degraded environments
- Existing chunks can be backfilled with:

```bash
cd apps/api
python scripts/backfill_embeddings.py --batch-size 32
```

- A scoped API backfill endpoint is also available at `POST /api/v1/documents/backfill-embeddings`

## Browser automation

- The `browser_automation` tool now runs real headless Playwright sessions instead of preview-only planning
- It can navigate to explicit HTTP(S) targets, capture visible text, headings, links, screenshots, HTML snapshots, and metadata records under `var/artifacts/browser-runs`
- Structured UI actions such as `click selector "..."`, `wait for selector "..."`, and `fill selector "..." with "..."` are supported when the prompt includes explicit approval language
- For local development, install Chromium once with:

```bash
cd apps/api
python -m playwright install chromium
```

- The API Docker image installs Chromium automatically during build

## Tooling and execution depth

- The `python_sandbox` tool now runs inside Docker with CPU, memory, PID, and no-network limits, then captures generated output artifacts under `var/artifacts/sandbox-runs`
- The `workspace_files` tool now enforces a clear policy boundary: it can read from the repository and only write tool outputs under `var/tool-workspace`
- The `document_export` tool can now produce Markdown, JSON, CSV, XLSX, and multi-artifact report bundles for analysis and content workflows
- The `notification_dispatch` tool creates durable email, Slack, and webhook outbox records, and can optionally attempt real webhook delivery
- The `background_jobs` tool queues long-running work into durable JSON job records under `var/artifacts/jobs/queue` so orchestration can defer bulk or latency-heavy tasks
- Every tool now emits a structured audit artifact under `var/artifacts/tool-audit/<tool>/...` with request metadata, timing, status, and generated artifact references

## Enterprise hardening

- API requests now flow through an enterprise guard middleware that issues request IDs, records request telemetry, and enforces in-memory rate limits before application handlers run
- Provider routing now records usage events, estimates model costs, enforces a configurable spend cap over the last 24 hours, and falls back cleanly when the primary provider is unavailable or the budget is exhausted
- In production, local provider fallback and demo bootstrap should be disabled so provider errors and budget exhaustion fail closed instead of silently degrading
- Sensitive browser interactions and live external webhook delivery now share a centralized approval policy instead of ad hoc tool-local checks
- The backend now exposes an owner/admin ops dashboard at `GET /api/v1/admin/ops` with request metrics, usage totals, budget posture, pending approvals, recent audit logs, and operational alerts
- The app monitor page now consumes the live ops dashboard instead of static placeholder telemetry

## Automation system

- The automation system now supports real recurring execution instead of CRUD-only records
- Supported schedule formats are `hourly@15`, `daily@08:00`, `weekdays@07:30`, and `weekly:mon,fri@09:15`
- Active automations are polled by an in-process scheduler loop started from the FastAPI lifespan
- Each execution is persisted with trigger source, attempt number, run/thread linkage, status, summary, and error details
- Scheduled workflows can require approval, in which case the scheduler moves them into an `awaiting_approval` state until a manual run is approved
- Manual runs reuse the chat runtime and persist into a dedicated thread per automation once the first run creates it

## Local development

### Web

```bash
cd apps/web
npm install
npm run dev
```

### API

```bash
cd apps/api
python -m venv .venv
. .venv/bin/activate
pip install -e .[dev]
alembic upgrade head
uvicorn app.main:app --reload
```

## Core architecture

- `SupervisorOrchestrator` decomposes requests into specialized agent tasks.
- Live chat runs stream plan creation, execution batches, per-step status, escalation, and final synthesis over SSE.
- The chat runtime now uses real persisted threads, thread-scoped run history, URL-addressable thread selection, and live workspace refresh after each run.
- Specialized agents use fast/slow Qwen model pairs.
- `ProviderRouter` abstracts model providers and supports Alibaba's OpenAI-compatible endpoint.
- `KnowledgeService` handles ingestion, chunking, and retrieval metadata.
- `ToolRegistry` manages safe tool exposure for web research, code execution, file access, and browser automation.
- Tool execution now includes filesystem policies, sandbox artifact capture, report generation, notification outboxes, and durable queued background jobs.

## Security notes

- API keys are environment-only and never committed.
- Tool calls emit audit events.
- Sensitive actions use approval states.
- Sandboxed execution is isolated through Docker.
- Retrieved content is normalized and tagged with provenance metadata.

## Included demo scope

This repository ships with a coherent MVP implementation of the platform:

- multi-agent orchestration primitives,
- streaming chat runs,
- RAG ingestion pipeline,
- enterprise data model,
- premium marketing homepage,
- chat workspace UI,
- Dockerized local stack,
- tests and demo seed paths.
