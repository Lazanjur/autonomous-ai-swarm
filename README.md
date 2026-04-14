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

If you keep the Qwen key only in PowerShell instead of writing it into `.env`, export it in the same shell before starting Docker:

```powershell
$env:ALIBABA_API_KEY="your-real-key"
docker compose up --build
```

The API container now prefers the PowerShell `ALIBABA_API_KEY` value over the placeholder in `.env`, so local chat can use the real Qwen provider without editing the file.

If you want local chat to use the real provider or fail loudly instead of silently falling back to the mock model, also set:

```powershell
$env:ALLOW_LOCAL_PROVIDER_FALLBACK="false"
```

NotebookLM-backed deliverables are also supported. For queries that ask for an audio overview, podcast, video overview, mind map, report, flashcards, quizzes, infographics, slide decks, or data tables, the orchestrator now prefers NotebookLM first and falls back only when NotebookLM cannot complete the job or you explicitly ask for a non-NotebookLM variant.

Install NotebookLM support in the API environment with:

```bash
cd apps/api
pip install "notebooklm-py[browser]"
```

If first-time NotebookLM login is needed, the package uses a browser-backed session. You can also set:

```bash
NOTEBOOKLM_ENABLED=true
NOTEBOOKLM_STORAGE_DIR=
```

The storage directory is optional; when unset, the backend uses `var/notebooklm`.

For the local Docker stack, NotebookLM storage is now bind-mounted from `./var/notebooklm` on the host into the API container at `/workspace/var/notebooklm`. That means a one-time NotebookLM login can be reused across container rebuilds as long as the login flow also points NotebookLM at the same storage home.

Recommended local flow:

1. Start the stack once with `docker compose up --build`.
2. Point NotebookLM's home/storage directory at `./var/notebooklm`.
3. Complete the package's browser-backed NotebookLM login flow one time.
4. Restart the API container if needed, then let the app reuse that stored NotebookLM session for future NotebookLM-native deliverables.

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

Production hardening is now included for:

- production posture validation before launch
- Prometheus metrics scraping
- Docker log aggregation through Vector
- backup creation and retention
- watchdog posture checks with optional webhook alerts
- structured secret-rotation plans

## Demo auth

Demo auth is intended for local and non-production environments.

After startup, sign in at `http://localhost:3000/signin` with:

- email: `demo@swarm.dev`
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
- Retry scheduling now uses a dedicated worker queue path with backoff timing, duplicate-execution protection, and retry observability in execution metadata
- Automation executions now persist a structured event timeline, approval state, retry state, and queued-notification history for the dashboard
- Notification policies can target `failed`, `completed`, `retry_scheduled`, `approval_requested`, and `rejected` execution outcomes
- Reusable browser/computer task templates can now prefill automation definitions so recurring workflows start from productized operating patterns instead of a blank prompt

## Local development

### Web

```bash
cd apps/web
npm install
npm run dev
```

### Web verification

```bash
cd apps/web
npm run typecheck
npx playwright install chromium
npm run test:e2e
```

- The Playwright suite runs the Next.js app in a deterministic E2E mock mode so the browser tests can verify the real shell, auth flow, task workspace, workspace switching, and key product surfaces without depending on the API runtime.
- CI now runs `typecheck`, `build`, and the Playwright suite for the web workspace.

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
- The chat workspace now includes reusable browser/computer task templates that prefill the operating brief and steer the operator pane toward the recommended mode.
- Specialized agents use fast/slow Qwen model pairs.
- `ProviderRouter` abstracts model providers and supports Alibaba's OpenAI-compatible endpoint.
- `KnowledgeService` handles ingestion, chunking, and retrieval metadata.
- `ToolRegistry` manages safe tool exposure for web research, code execution, file access, and browser automation.
- Tool execution now includes filesystem policies, sandbox artifact capture, report generation, notification outboxes, durable queued background jobs, and approval-aware external integrations.

## External integrations

- The external integration layer now supports live delivery for email, Slack, webhooks, calendar events, and generic REST endpoints when the corresponding provider credentials are configured.
- Email delivery supports SMTP or Resend.
- Slack delivery supports incoming webhooks or a bot token using `chat.postMessage`.
- Calendar delivery supports Google Calendar or Microsoft Graph.
- All live outbound integrations remain gated behind explicit approval language and continue to persist durable outbox/audit records even when delivery is performed.

## NotebookLM deliverables

- NotebookLM is now the preferred path for NotebookLM-native outputs: audio overviews, podcasts, video overviews, mind maps, reports, flashcards, quizzes, infographics, slide decks, and data tables.
- The backend uses a dedicated `notebooklm_studio` tool that can create a notebook, attach URL or file sources, upload an execution brief, generate the requested deliverable, and download the resulting artifact into `var/artifacts/notebooklm/...`.
- In local Docker development, the shared NotebookLM session home lives under `./var/notebooklm`, so a one-time NotebookLM login can persist across rebuilds.
- If NotebookLM is unavailable, not installed, or not authenticated yet, the run reports that cleanly and only then falls back to another generation route.

## Security notes

- API keys are environment-only and never committed.
- Tool calls emit audit events.
- Sensitive actions use approval states.
- Sandboxed execution is isolated through Docker.
- Retrieved content is normalized and tagged with provenance metadata.
- Production readiness now fails closed when domain, secret, demo-mode, or provider-fallback posture is invalid.
- Internal metrics are available for scrapers, while public metrics paths are blocked at the edge.
- Backup, watchdog, and secret-rotation scripts live under `infrastructure/scripts`.

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
