from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.services.workflows.run_service import RunService


class _ScalarResult:
    def __init__(self, value):
        self._value = value

    def scalar_one(self):
        return self._value

    def scalar_one_or_none(self):
        return self._value


class _ScalarsResult:
    def __init__(self, values):
        self._values = values

    def scalars(self):
        return self

    def all(self):
        return self._values


class _SessionStub:
    def __init__(self, responses):
        self._responses = responses
        self._index = 0

    async def execute(self, _query):
        response = self._responses[self._index]
        self._index += 1
        return response


@pytest.mark.asyncio
async def test_sync_thread_checklist_to_markdown_creates_managed_block(tmp_path: Path):
    service = RunService()
    service.filesystem.root = tmp_path.resolve()
    service.filesystem.write_root = (tmp_path / "var" / "tool-workspace").resolve()
    service.filesystem.write_root.mkdir(parents=True, exist_ok=True)

    workspace_id = uuid4()
    thread_id = uuid4()
    run_id = uuid4()
    now = datetime.now(timezone.utc)

    workspace = SimpleNamespace(id=workspace_id)
    thread = SimpleNamespace(id=thread_id, workspace_id=workspace_id, title="Deploy website")
    run = SimpleNamespace(
        id=run_id,
        thread_id=thread_id,
        status="completed",
        plan=[
            {
                "key": "research",
                "objective": "Analyze the repo and deployment requirements",
                "execution_mode": "sequential",
                "dependencies": [],
            },
            {
                "key": "coding",
                "objective": "Deploy the production stack",
                "execution_mode": "sequential",
                "dependencies": ["research"],
            },
        ],
    )
    run_steps = [
        SimpleNamespace(
            run_id=run_id,
            step_index=0,
            created_at=now,
            status="completed",
            agent_name="Research Agent",
            output_payload={"summary": "Mapped the deployment flow and required services."},
        ),
        SimpleNamespace(
            run_id=run_id,
            step_index=1,
            created_at=now,
            status="completed",
            agent_name="Coding Agent",
            output_payload={"content": "Shipped the production deployment configuration."},
        ),
    ]

    session = _SessionStub(
        [
            _ScalarResult(workspace),
            _ScalarResult(thread),
            _ScalarResult(run),
            _ScalarsResult(run_steps),
        ]
    )

    result = await service.sync_thread_checklist_to_markdown(
        session,
        workspace_id=workspace_id,
        thread_id=thread_id,
        relative_path="todo.md",
        heading="Deployment Checklist",
    )

    todo_file = tmp_path / "todo.md"
    assert todo_file.exists()
    content = todo_file.read_text(encoding="utf-8")
    assert "## Deployment Checklist" in content
    assert "- [x] Analyze the repo and deployment requirements" in content
    assert "- [x] Deploy the production stack" in content
    assert "Depends on: research" in content
    assert result["completed_items"] == 2
    assert result["total_items"] == 2
    assert result["file"]["relative_path"] == "todo.md"
