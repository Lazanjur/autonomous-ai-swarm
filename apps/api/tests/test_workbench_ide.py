from uuid import uuid4

import pytest

from app.models.entities import Workspace
from app.services.workflows.run_service import RunService


class _ScalarResult:
    def __init__(self, value):
        self._value = value

    def scalar_one(self):
        return self._value


class _SessionStub:
    def __init__(self, responses):
        self._responses = responses
        self._index = 0

    async def execute(self, _query):
        response = self._responses[self._index]
        self._index += 1
        return response


@pytest.mark.asyncio
async def test_save_workbench_file_updates_existing_repo_file(tmp_path):
    service = RunService()
    service.filesystem.root = tmp_path
    service.filesystem.write_root = tmp_path / "var" / "tool-workspace"
    service.filesystem.write_root.mkdir(parents=True, exist_ok=True)

    target = tmp_path / "README.md"
    target.write_text("old content", encoding="utf-8")

    workspace = Workspace(
        id=uuid4(),
        organization_id=uuid4(),
        name="Workspace",
        slug="workspace",
    )
    session = _SessionStub([_ScalarResult(workspace)])

    result = await service.save_workbench_file(
        session,
        workspace_id=workspace.id,
        relative_path="README.md",
        content="new content",
    )

    assert target.read_text(encoding="utf-8") == "new content"
    assert result["file"]["relative_path"] == "README.md"
    assert result["file"]["content"] == "new content"


@pytest.mark.asyncio
async def test_get_workbench_repo_status_returns_non_repo_defaults(tmp_path):
    service = RunService()
    service.filesystem.root = tmp_path
    service.filesystem.write_root = tmp_path / "var" / "tool-workspace"
    service.filesystem.write_root.mkdir(parents=True, exist_ok=True)

    workspace = Workspace(
        id=uuid4(),
        organization_id=uuid4(),
        name="Workspace",
        slug="workspace",
    )
    session = _SessionStub([_ScalarResult(workspace)])

    result = await service.get_workbench_repo_status(session, workspace_id=workspace.id)

    assert result["workspace"].id == workspace.id
    assert result["is_repo"] is False
    assert result["changed_files"] == []
