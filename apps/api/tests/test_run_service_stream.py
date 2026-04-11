from types import SimpleNamespace
from datetime import datetime, timezone
from uuid import uuid4

import pytest

from app.schemas.chat import ChatRunRequest
from app.services.workflows.run_service import RunService


@pytest.mark.asyncio
async def test_stream_run_emits_live_batch_and_step_events(monkeypatch):
    service = RunService()
    workspace_id = uuid4()
    payload = ChatRunRequest(workspace_id=workspace_id, message="Build an internal API.")
    thread = SimpleNamespace(id=uuid4(), workspace_id=workspace_id, title="Internal API")
    run = SimpleNamespace(
        id=uuid4(),
        thread_id=thread.id,
        workspace_id=workspace_id,
        status="running",
        created_at=datetime.now(timezone.utc),
        user_message=payload.message,
    )

    async def fake_resolve_thread(session, request, actor_id=None):
        return thread

    async def fake_start_run(session, *, payload, thread):
        return run

    async def fake_execute(message, event_handler=None):
        await event_handler("plan", {"plan": [{"key": "coding", "plan_index": 0}]})
        await event_handler("batches", {"batches": [["coding"]]})
        await event_handler(
            "batch.started",
            {"batch_index": 0, "tasks": ["coding"], "statuses": {"coding": "queued"}},
        )
        await event_handler(
            "step.started",
            {
                "step_index": 0,
                "batch_index": 0,
                "agent_key": "coding",
                "agent_name": "Coding Agent",
                "objective": "Design the API.",
                "dependencies": [],
                "execution_mode": "parallel",
                "status": "running",
            },
        )
        await event_handler(
            "step.completed",
            {
                "step_index": 0,
                "batch_index": 0,
                "agent_key": "coding",
                "agent_name": "Coding Agent",
                "status": "completed",
                "dependencies": [],
                "execution_mode": "parallel",
                "confidence": 0.91,
                "validation": {"summary": "Validation passed."},
                "summary": "API design completed.",
                "model": "qwen3-coder-plus",
                "provider": "mock-local",
                "tools": [{"tool": "python_sandbox", "status": "completed"}],
            },
        )
        await event_handler(
            "batch.completed",
            {"batch_index": 0, "tasks": ["coding"], "statuses": {"coding": "completed"}},
        )
        return {
            "plan": [{"key": "coding", "plan_index": 0}],
            "execution_batches": [["coding"]],
            "steps": [],
            "final_response": "Finished.",
            "summary": "Done.",
            "citations": [],
            "scratchpad": {"completed_agents": ["coding"]},
        }

    async def fake_finalize(session, *, payload, result, thread, run, actor_id=None):
        return thread, SimpleNamespace(id=run.id, status="completed"), []

    monkeypatch.setattr(service, "_resolve_thread", fake_resolve_thread)
    monkeypatch.setattr(service, "_start_run", fake_start_run)
    monkeypatch.setattr(service.orchestrator, "execute", fake_execute)
    monkeypatch.setattr(service, "_finalize_run", fake_finalize)

    events = []
    async for event in service.stream_run(session=None, payload=payload):
        events.append(event)

    event_names = [event["event"] for event in events]
    assert event_names == [
        "thread",
        "run.created",
        "plan",
        "batches",
        "batch.started",
        "step.started",
        "step.completed",
        "batch.completed",
        "final",
        "run.persisted",
        "done",
    ]
    assert events[-2]["data"]["status"] == "completed"
