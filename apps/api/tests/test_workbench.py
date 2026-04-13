from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.services.workflows.run_service import RunService


class _ScalarResult:
    def __init__(self, value):
        self._value = value

    def scalar_one(self):
        return self._value


class _SessionStub:
    def __init__(self, workspace):
        self.workspace = workspace

    async def execute(self, _query):
        return _ScalarResult(self.workspace)


@pytest.mark.asyncio
async def test_get_workbench_tree_shapes_entries(monkeypatch):
    service = RunService()
    workspace = SimpleNamespace(id=uuid4())
    session = _SessionStub(workspace)

    async def fake_list_files(*, relative_path=".", recursive=False):
        assert relative_path == "."
        assert recursive is False
        return {
            "status": "completed",
            "entries": [
                {
                    "name": "apps",
                    "relative_path": "apps",
                    "kind": "dir",
                    "extension": None,
                    "size_bytes": None,
                },
                {
                    "name": "README.md",
                    "relative_path": "README.md",
                    "kind": "file",
                    "extension": ".md",
                    "size_bytes": 512,
                },
            ],
        }

    monkeypatch.setattr(service.filesystem, "list_files", fake_list_files)
    monkeypatch.setattr(service.filesystem, "root", SimpleNamespace(name="autonomous-ai-swarm"))

    payload = await service.get_workbench_tree(session, workspace_id=workspace.id, relative_path=".")

    assert payload["workspace"] == workspace
    assert payload["root_label"] == "autonomous-ai-swarm"
    assert payload["relative_path"] == "."
    assert payload["parent_relative_path"] is None
    assert payload["entries"][0]["kind"] == "dir"
    assert payload["entries"][1]["extension"] == ".md"


@pytest.mark.asyncio
async def test_get_workbench_file_returns_metadata(monkeypatch, tmp_path):
    service = RunService()
    workspace = SimpleNamespace(id=uuid4())
    session = _SessionStub(workspace)
    file_path = tmp_path / "README.md"
    file_path.write_text("# Demo\n", encoding="utf-8")

    async def fake_read_text(*, relative_path, max_chars):
        assert relative_path == "README.md"
        assert max_chars == 24000
        return {
            "status": "completed",
            "relative_path": "README.md",
            "name": "README.md",
            "extension": ".md",
            "size_bytes": file_path.stat().st_size,
            "truncated": False,
            "content": "# Demo\n",
        }

    monkeypatch.setattr(service.filesystem, "read_text", fake_read_text)
    monkeypatch.setattr(service.filesystem, "resolve_read_path", lambda relative_path: file_path)
    monkeypatch.setattr(service.filesystem, "root", SimpleNamespace(name="autonomous-ai-swarm"))

    payload = await service.get_workbench_file(session, workspace_id=workspace.id, relative_path="README.md")

    assert payload["workspace"] == workspace
    assert payload["name"] == "README.md"
    assert payload["extension"] == ".md"
    assert payload["size_bytes"] == file_path.stat().st_size
    assert payload["content"] == "# Demo\n"
