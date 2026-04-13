from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.services.workflows.run_service import RunService


class _ScalarResult:
    def __init__(self, value):
        self._value = value

    def scalar_one(self):
        return self._value


class _RowsResult:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return self._rows


class _SessionStub:
    def __init__(self, workspace, step_rows, tool_rows):
        self.workspace = workspace
        self.step_rows = step_rows
        self.tool_rows = tool_rows
        self.calls = 0

    async def execute(self, _query):
        self.calls += 1
        if self.calls == 1:
            return _ScalarResult(self.workspace)
        if self.calls == 2:
            return _RowsResult(self.step_rows)
        return _RowsResult(self.tool_rows)


@pytest.mark.asyncio
async def test_get_agents_surface_builds_catalog_and_activity():
    service = RunService()
    workspace = SimpleNamespace(id=uuid4())
    now = datetime.now(timezone.utc)
    coding_step_id = uuid4()
    research_step_id = uuid4()
    rows = [
        (
            SimpleNamespace(
                id=coding_step_id,
                agent_name="Coding Agent",
                confidence=0.92,
                status="completed",
                created_at=now,
                output_payload={
                    "content": "Implemented workspace sidebar upgrades.",
                    "model": "qwen3-coder-plus",
                    "provider": "alibaba",
                    "validation": {"summary": "Good result", "escalated_from_fast": True},
                },
            ),
            SimpleNamespace(id=uuid4(), workspace_id=workspace.id),
            SimpleNamespace(id=uuid4(), title="Implement sidebar", project_id=uuid4()),
        ),
        (
            SimpleNamespace(
                id=research_step_id,
                agent_name="Research Agent",
                confidence=0.81,
                status="completed",
                created_at=now,
                output_payload={
                    "summary": "Collected product references and UI examples.",
                    "model": "qwen3.6-plus",
                    "provider": "alibaba",
                },
            ),
            SimpleNamespace(id=uuid4(), workspace_id=workspace.id),
            SimpleNamespace(id=uuid4(), title="Research UI patterns", project_id=None),
        ),
    ]
    tool_rows = [
        (SimpleNamespace(run_step_id=coding_step_id, tool_name="workspace_files"),),
        (SimpleNamespace(run_step_id=coding_step_id, tool_name="python_sandbox"),),
        (SimpleNamespace(run_step_id=research_step_id, tool_name="web_search"),),
    ]
    session = _SessionStub(workspace, rows, tool_rows)

    payload = await service.get_agents_surface(session, workspace_id=workspace.id)

    assert payload["workspace"] == workspace
    assert payload["supervisor_model"]
    assert payload["overview"]["total_agents"] >= 1
    assert payload["overview"]["total_tool_calls"] == 3
    assert payload["overview"]["escalation_count"] == 1
    assert payload["recent_activity"]
    assert any(
        agent["key"] == "coding"
        and agent["step_count"] == 1
        and agent["tool_call_count"] == 2
        and agent["recent_steps"]
        for agent in payload["agents"]
    )
    assert any(
        agent["key"] == "research"
        and agent["recent_summaries"]
        and agent["recent_tools"] == ["web_search"]
        for agent in payload["agents"]
    )
