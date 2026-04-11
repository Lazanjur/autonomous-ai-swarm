# Architecture

## Runtime

- `FastAPI` serves REST + streaming endpoints.
- `Next.js` serves the marketing site and authenticated app shell.
- `PostgreSQL + pgvector` stores operational data and retrieval metadata.
- `Redis` supports ephemeral coordination and pub/sub hooks.
- `MinIO` stores generated artifacts and uploaded files.

## Orchestration

The supervisor receives each user task and:

1. classifies intent,
2. produces a plan,
3. delegates subtasks to specialized agents,
4. validates intermediate outputs,
5. synthesizes the final answer.

## Agents

- Research
- Analysis
- Content
- Coding
- Vision / Automation

Each agent exposes a fast model and a slow escalation model. Routing decisions consider confidence, risk, and budget.

## Retrieval

- document ingestion
- content chunking
- provenance capture
- workspace scoping
- hybrid retrieval hooks

## Safety

- secret isolation
- audit trails
- tool policy gates
- approval checkpoints
- sandboxed execution
