from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.schemas.chat import ChatRunRequest
from app.services.workflows.run_service import RunService


def test_merge_shared_memory_rolls_forward_run_context():
    service = RunService()
    workspace_id = uuid4()
    thread = SimpleNamespace(id=uuid4())
    run = SimpleNamespace(id=uuid4())
    payload = ChatRunRequest(
        workspace_id=workspace_id,
        thread_id=thread.id,
        message="Launch the production swarm deployment and document the rollout.",
    )
    existing = {
        "summary": "Existing thread context.",
        "findings": ["Current deployment uses docker compose."],
        "risks": ["Secrets are still placeholder values."],
        "open_questions": ["Which domain should become primary?"],
        "recent_requests": ["Prepare the internet deployment flow."],
        "recent_summaries": ["Deployment planning completed."],
        "focus_areas": ["Production rollout"],
        "agent_memory": [{"agent": "Research Agent", "summary": "Mapped the hosting constraints."}],
        "run_count": 2,
        "last_updated_at": datetime.now(timezone.utc).isoformat(),
        "source_run_id": str(uuid4()),
        "source_thread_id": str(thread.id),
    }
    result = {
        "summary": "Supervisor coordinated a deployment-ready launch pass.",
        "final_response": "Deployment-ready launch pass completed with rollout and risks.",
        "plan": [
            {"objective": "Verify the production deployment path"},
            {"objective": "Document rollout and launch controls"},
        ],
        "steps": [
            {
                "agent_name": "Coding Agent",
                "content": "Implemented the production deployment workflow and tightened runtime defaults.",
                "confidence": 0.91,
            },
            {
                "agent_name": "Analysis Agent",
                "content": "Documented rollout risks, sequencing, and launch controls.",
                "confidence": 0.84,
            },
        ],
        "scratchpad": {
            "findings": [
                {"summary": "Production compose and domain wiring are now aligned."},
            ],
            "risks": ["SSL cutover still depends on DNS propagation."],
            "open_questions": ["Should launch happen behind a maintenance page?"],
        },
    }

    merged = service._merge_shared_memory(
        existing=existing,
        payload=payload,
        thread=thread,
        run=run,
        result=result,
    )

    assert merged["run_count"] == 3
    assert merged["summary"] == "Supervisor coordinated a deployment-ready launch pass."
    assert "Production compose and domain wiring are now aligned." in merged["findings"]
    assert "SSL cutover still depends on DNS propagation." in merged["risks"]
    assert "Should launch happen behind a maintenance page?" in merged["open_questions"]
    assert merged["recent_requests"][0].startswith("Launch the production swarm deployment")
    assert "Verify the production deployment path" in merged["focus_areas"]
    assert merged["agent_memory"][0]["agent"] in {"Coding Agent", "Analysis Agent"}
    assert merged["source_run_id"] == str(run.id)
    assert merged["source_thread_id"] == str(thread.id)


@pytest.mark.asyncio
async def test_create_run_passes_memory_context_to_orchestrator(monkeypatch):
    service = RunService()
    workspace_id = uuid4()
    project_id = uuid4()
    thread_id = uuid4()
    run_id = uuid4()
    payload = ChatRunRequest(
        workspace_id=workspace_id,
        thread_id=thread_id,
        project_id=project_id,
        message="Continue the project rollout with the latest task memory.",
    )
    thread = SimpleNamespace(
        id=thread_id,
        workspace_id=workspace_id,
        project_id=project_id,
        metadata={"shared_memory": {"summary": "Task memory", "run_count": 2}},
    )
    project = SimpleNamespace(
        id=project_id,
        workspace_id=workspace_id,
        metadata={"shared_memory": {"summary": "Project memory", "run_count": 5}},
    )
    run = SimpleNamespace(id=run_id, workspace_id=workspace_id)
    captured: dict[str, object] = {}

    async def fake_resolve_thread(_session, _payload, *, actor_id=None):
        return thread

    async def fake_load_thread_project(_session, _thread):
        return project

    async def fake_start_run(_session, *, payload, thread):
        return run

    async def fake_finalize_run(_session, *, payload, result, thread, project, run, actor_id=None):
        return thread, run, []

    async def fake_execute(prompt, *, metadata=None, memory_context=None, event_handler=None):
        captured["prompt"] = prompt
        captured["metadata"] = metadata
        captured["memory_context"] = memory_context
        return {
            "plan": [],
            "execution_batches": [],
            "steps": [],
            "final_response": "done",
            "summary": "done",
            "citations": [],
            "scratchpad": {},
        }

    monkeypatch.setattr(service, "_resolve_thread", fake_resolve_thread)
    monkeypatch.setattr(service, "_load_thread_project", fake_load_thread_project)
    monkeypatch.setattr(service, "_start_run", fake_start_run)
    monkeypatch.setattr(service, "_finalize_run", fake_finalize_run)
    monkeypatch.setattr(service.orchestrator, "execute", fake_execute)

    await service.create_run(SimpleNamespace(), payload, actor_id=uuid4())

    assert captured["prompt"] == payload.message
    assert captured["metadata"]["thread_id"] == str(thread_id)
    assert captured["metadata"]["project_id"] == str(project_id)
    assert captured["memory_context"] == {
        "task_memory": service._read_thread_shared_memory(thread),
        "project_memory": service._read_project_shared_memory(project),
    }


@pytest.mark.asyncio
async def test_get_chat_workspace_exposes_task_and_project_memory(monkeypatch):
    service = RunService()
    workspace_id = uuid4()
    project_id = uuid4()
    thread_id = uuid4()
    now = datetime.now(timezone.utc)
    workspace = SimpleNamespace(id=workspace_id)
    thread = SimpleNamespace(
        id=thread_id,
        workspace_id=workspace_id,
        project_id=project_id,
        title="Deploy launch",
        status="active",
        metadata={"shared_memory": {"summary": "Thread memory", "run_count": 1}},
        created_at=now,
        updated_at=now,
    )
    project = SimpleNamespace(
        id=project_id,
        workspace_id=workspace_id,
        name="Launch project",
        description="Main rollout",
        status="active",
        metadata={"shared_memory": {"summary": "Project memory", "run_count": 3}},
        created_at=now,
        updated_at=now,
    )

    async def fake_list_workspace_threads(_session, _workspace_id):
        return workspace, [thread]

    async def fake_list_workspace_projects(_session, _workspace_id):
        return [project]

    async def fake_build_thread_summaries(_session, _threads):
        return [
            {
                "id": thread.id,
                "workspace_id": thread.workspace_id,
                "project_id": thread.project_id,
                "title": thread.title,
                "status": thread.status,
                "metadata": thread.metadata_,
                "created_at": thread.created_at,
                "updated_at": thread.updated_at,
                "message_count": 0,
                "run_count": 0,
                "last_message_preview": None,
                "last_activity_at": thread.updated_at,
            }
        ]

    async def fake_get_messages(_session, _thread_id):
        return []

    async def fake_list_thread_runs(_session, _thread_id, *, limit=15):
        return []

    monkeypatch.setattr(service, "list_workspace_threads", fake_list_workspace_threads)
    monkeypatch.setattr(service, "list_workspace_projects", fake_list_workspace_projects)
    monkeypatch.setattr(service, "_build_thread_summaries", fake_build_thread_summaries)
    monkeypatch.setattr(service, "get_messages", fake_get_messages)
    monkeypatch.setattr(service, "list_thread_runs", fake_list_thread_runs)

    runtime = await service.get_chat_workspace(SimpleNamespace(), workspace_id=workspace_id, thread_id=thread_id)

    assert runtime["selected_thread"].id == thread_id
    assert runtime["selected_project"].id == project_id
    assert runtime["task_memory"]["summary"] == "Thread memory"
    assert runtime["project_memory"]["summary"] == "Project memory"
