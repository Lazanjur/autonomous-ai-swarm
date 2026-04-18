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

    async def fake_execute(message, metadata=None, event_handler=None):
        await event_handler("plan", {"plan": [{"key": "coding", "plan_index": 0}]})
        await event_handler("batches", {"batches": [["coding"]]})
        await event_handler(
            "batch.started",
            {"batch_index": 0, "tasks": ["coding"], "statuses": {"coding": "queued"}},
        )
        await event_handler(
            "tool.started",
            {
                "agent_key": "coding",
                "agent_name": "Coding Agent",
                "step_index": 0,
                "batch_index": 0,
                "tool": "python_sandbox",
                "status": "running",
            },
        )
        await event_handler(
            "tool.output",
            {
                "agent_key": "coding",
                "agent_name": "Coding Agent",
                "step_index": 0,
                "batch_index": 0,
                "tool": "python_sandbox",
                "operation": "execute_python",
                "status": "running",
                "summary": "Streaming terminal output.",
                "output_preview": "ready",
                "artifacts": [],
            },
        )
        await event_handler(
            "terminal.stdout",
            {
                "agent_key": "coding",
                "agent_name": "Coding Agent",
                "step_index": 0,
                "batch_index": 0,
                "session_id": "sandbox-session",
                "session_kind": "terminal",
                "tool": "python_sandbox",
                "status": "running",
                "stream": "stdout",
                "stdout_delta": "ready\n",
            },
        )
        await event_handler(
            "computer.session.completed",
            {
                "agent_key": "coding",
                "agent_name": "Coding Agent",
                "step_index": 0,
                "batch_index": 0,
                "session_id": "sandbox-session",
                "session_kind": "terminal",
                "tool": "python_sandbox",
                "status": "completed",
                "command": ["python", "task.py"],
                "stdout": "ready",
                "stderr": "",
                "returncode": 0,
                "artifacts": [],
            },
        )
        await event_handler(
            "browser.snapshot",
            {
                "agent_key": "coding",
                "agent_name": "Coding Agent",
                "step_index": 0,
                "batch_index": 0,
                "session_id": "browser-session",
                "session_kind": "browser",
                "tool": "browser_automation",
                "status": "running",
                "target_url": "https://example.com",
                "final_url": "https://example.com",
                "page_title": "Example",
                "headings": ["Example"],
                "links": [],
                "extracted_text": "Snapshot ready",
                "artifacts": [],
            },
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
        "tool.started",
        "tool.output",
        "terminal.stdout",
        "computer.session.completed",
        "browser.snapshot",
        "step.started",
        "step.completed",
        "batch.completed",
        "final",
        "run.persisted",
        "done",
    ]
    assert events[-2]["data"]["status"] == "completed"


@pytest.mark.asyncio
async def test_stream_run_browser_fast_path_emits_live_events(monkeypatch):
    service = RunService()
    workspace_id = uuid4()
    payload = ChatRunRequest(
        workspace_id=workspace_id,
        message="Open www.investbusiness.com, and then login with credentials: email: firma@investbusiness.org and pw: 123456",
    )
    thread = SimpleNamespace(id=uuid4(), workspace_id=workspace_id, title="Browser task", project_id=None)
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

    async def fake_load_thread_project(session, resolved_thread):
        return None

    async def fake_start_run(session, *, payload, thread):
        return run

    async def fake_finalize(session, *, payload, result, thread, project, run, actor_id=None):
        return thread, SimpleNamespace(id=run.id, status="completed"), []

    async def fake_execute_named(agent_key, tool_name, args, event_handler=None, event_context=None):
        return {
            "tool": tool_name,
            "status": "completed",
            "target_url": "https://www.investbusiness.com",
            "final_url": "https://www.investbusiness.com/dashboard",
            "page_title": "Invest Business",
            "extracted_text": "Dashboard loaded successfully.",
            "artifacts": [],
        }

    monkeypatch.setattr(service, "_resolve_thread", fake_resolve_thread)
    monkeypatch.setattr(service, "_load_thread_project", fake_load_thread_project)
    monkeypatch.setattr(service, "_start_run", fake_start_run)
    monkeypatch.setattr(service, "_finalize_run", fake_finalize)
    monkeypatch.setattr(service.tools_registry, "execute_named", fake_execute_named)

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
        "final",
        "run.persisted",
        "done",
    ]
    assert events[-2]["data"]["status"] == "completed"
    assert all(event["event"] != "error" for event in events)
