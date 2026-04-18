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
        self.added: list[object] = []
        self.commit_count = 0

    async def execute(self, _query):
        return _ScalarResult(self.workspace)

    def add(self, value):
        self.added.append(value)

    async def commit(self):
        self.commit_count += 1

    async def refresh(self, _value):
        return None


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

    async def fake_suggest_related_files(relative_path, *, max_results):
        assert relative_path == "README.md"
        assert max_results == 8
        return {
            "status": "completed",
            "related_files": [
                {
                    "relative_path": "README.test.md",
                    "name": "README.test.md",
                    "extension": ".md",
                    "reason": "Likely test/spec companion.",
                    "score": 90,
                }
            ],
        }

    monkeypatch.setattr(service.filesystem, "read_text", fake_read_text)
    monkeypatch.setattr(service.filesystem, "suggest_related_files", fake_suggest_related_files)
    monkeypatch.setattr(service.filesystem, "resolve_read_path", lambda relative_path: file_path)
    monkeypatch.setattr(service.filesystem, "root", SimpleNamespace(name="autonomous-ai-swarm"))

    payload = await service.get_workbench_file(session, workspace_id=workspace.id, relative_path="README.md")

    assert payload["workspace"] == workspace
    assert payload["name"] == "README.md"
    assert payload["extension"] == ".md"
    assert payload["size_bytes"] == file_path.stat().st_size
    assert payload["content"] == "# Demo\n"
    assert payload["related_files"][0]["relative_path"] == "README.test.md"


@pytest.mark.asyncio
async def test_create_workbench_branch_returns_repo_payload(monkeypatch):
    service = RunService()
    workspace = SimpleNamespace(id=uuid4())
    session = _SessionStub(workspace)
    calls: list[tuple[str, ...]] = []

    async def fake_build_repo_payload():
        return {
            "is_repo": True,
            "root_label": "autonomous-ai-swarm",
            "branch": "feature/test-workbench" if calls else "main",
            "head": "abc1234",
            "dirty": False,
            "summary": None,
            "changed_files": [],
            "staged_count": 0,
            "unstaged_count": 0,
            "untracked_count": 0,
        }

    async def fake_run_git_command(*args):
        calls.append(args)
        return 0, "", ""

    monkeypatch.setattr(service, "_build_workbench_repo_payload", fake_build_repo_payload)
    monkeypatch.setattr(service, "_run_git_command", fake_run_git_command)

    payload = await service.create_workbench_branch(
        session,
        workspace_id=workspace.id,
        branch_name="feature/test-workbench",
        from_ref="HEAD",
    )

    assert calls == [("checkout", "-b", "feature/test-workbench", "HEAD")]
    assert payload["branch_name"] == "feature/test-workbench"
    assert payload["repo"]["branch"] == "feature/test-workbench"


@pytest.mark.asyncio
async def test_commit_workbench_changes_handles_no_changes(monkeypatch):
    service = RunService()
    workspace = SimpleNamespace(id=uuid4())
    session = _SessionStub(workspace)

    async def fake_build_repo_payload():
        return {
            "is_repo": True,
            "root_label": "autonomous-ai-swarm",
            "branch": "main",
            "head": "abc1234",
            "dirty": False,
            "summary": None,
            "changed_files": [],
            "staged_count": 0,
            "unstaged_count": 0,
            "untracked_count": 0,
        }

    async def fake_run_git_command(*args):
        if args[0] == "add":
            return 0, "", ""
        if args[0] == "commit":
            return 1, "", "nothing to commit, working tree clean"
        raise AssertionError(f"Unexpected git command: {args}")

    monkeypatch.setattr(service, "_build_workbench_repo_payload", fake_build_repo_payload)
    monkeypatch.setattr(service, "_run_git_command", fake_run_git_command)

    payload = await service.commit_workbench_changes(
        session,
        workspace_id=workspace.id,
        message="Checkpoint changes",
    )

    assert payload["committed"] is False
    assert payload["note"] == "No changes were available to commit."


@pytest.mark.asyncio
async def test_rollback_workbench_changes_restores_paths(monkeypatch):
    service = RunService()
    workspace = SimpleNamespace(id=uuid4())
    session = _SessionStub(workspace)
    calls: list[tuple[str, ...]] = []

    async def fake_build_repo_payload():
        return {
            "is_repo": True,
            "root_label": "autonomous-ai-swarm",
            "branch": "main",
            "head": "abc1234",
            "dirty": False,
            "summary": None,
            "changed_files": [],
            "staged_count": 0,
            "unstaged_count": 0,
            "untracked_count": 1,
        }

    async def fake_run_git_command(*args):
        calls.append(args)
        return 0, "", ""

    monkeypatch.setattr(service, "_build_workbench_repo_payload", fake_build_repo_payload)
    monkeypatch.setattr(service, "_run_git_command", fake_run_git_command)

    payload = await service.rollback_workbench_changes(
        session,
        workspace_id=workspace.id,
        paths=["apps/api/app/main.py"],
    )

    assert calls == [("restore", "--source=HEAD", "--staged", "--worktree", "--", "apps/api/app/main.py")]
    assert payload["restored"] is True
    assert payload["restored_paths"] == ["apps/api/app/main.py"]
    assert "Untracked files were left untouched" in (payload["note"] or "")
