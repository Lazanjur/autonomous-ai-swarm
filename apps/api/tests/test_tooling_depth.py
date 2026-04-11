import subprocess

import pytest

from app.services.tools.document import DocumentExportTool
from app.services.tools.filesystem import WorkspaceFilesystemTool
from app.services.tools.jobs import BackgroundJobTool
from app.services.tools.notifications import NotificationDispatchTool
from app.services.tools.registry import ToolRegistry
from app.services.tools.sandbox import DockerSandboxExecutor


class FakeStorage:
    def __init__(self) -> None:
        self.saved: dict[str, bytes | str | dict | list] = {}

    def save_bytes(self, key: str, content: bytes) -> str:
        self.saved[key] = content
        return f"/fake/{key}"

    def save_text(self, key: str, content: str) -> str:
        self.saved[key] = content
        return f"/fake/{key}"

    def save_json(self, key: str, payload):
        self.saved[key] = payload
        return f"/fake/{key}"


@pytest.mark.asyncio
async def test_sandbox_captures_generated_artifacts(monkeypatch):
    executor = DockerSandboxExecutor(storage=FakeStorage())

    def fake_run(command, capture_output, text, timeout, check):
        volume_flag_index = command.index("-v")
        workspace = command[volume_flag_index + 1].rsplit(":", 1)[0]
        from pathlib import Path

        Path(workspace, "result.txt").write_text("done", encoding="utf-8")
        return subprocess.CompletedProcess(command, 0, stdout="ok", stderr="")

    monkeypatch.setattr("app.services.tools.sandbox.subprocess.run", fake_run)

    result = await executor.execute_python("print('ok')")

    assert result["status"] == "completed"
    assert result["returncode"] == 0
    assert result["artifacts"][0]["relative_path"] == "result.txt"
    assert result["audit"]["status"] == "completed"


@pytest.mark.asyncio
async def test_filesystem_enforces_write_boundary():
    tool = WorkspaceFilesystemTool()

    denied = await tool.write_text("../outside.txt", "nope")
    allowed = await tool.write_text("notes/output.txt", "safe", overwrite=True)
    read_back = await tool.read_text("var/tool-workspace/notes/output.txt")

    assert denied["status"] == "failed"
    assert "outside the allowed tool write root" in denied["error"]
    assert allowed["status"] == "completed"
    assert read_back["status"] == "completed"
    assert read_back["content"] == "safe"


@pytest.mark.asyncio
async def test_document_export_supports_spreadsheet_formats():
    tool = DocumentExportTool(storage=FakeStorage())

    csv_result = await tool.export_table("metrics", [{"team": "alpha", "score": 4}], format="csv")
    xlsx_result = await tool.export_table("metrics", [{"team": "alpha", "score": 4}], format="xlsx")

    assert csv_result["status"] == "completed"
    assert csv_result["artifacts"][0]["storage_key"].endswith(".csv")
    assert xlsx_result["status"] == "completed"
    assert xlsx_result["artifacts"][0]["storage_key"].endswith(".xlsx")


@pytest.mark.asyncio
async def test_notification_tool_queues_webhook_without_delivery():
    tool = NotificationDispatchTool(storage=FakeStorage())

    result = await tool.send_webhook(url="https://example.com/hook", payload={"ok": True}, deliver=False)

    assert result["status"] == "completed"
    assert result["channel"] == "webhook"
    assert result["outbox"]["storage_key"].startswith("notifications/outbox/webhook/")
    assert result["audit"]["status"] == "completed"


@pytest.mark.asyncio
async def test_background_job_tool_queues_durable_record():
    tool = BackgroundJobTool(storage=FakeStorage())

    result = await tool.enqueue(job_type="dataset_processing", payload={"dataset_id": "ds_123"}, priority="high")

    assert result["status"] == "queued"
    assert result["job_type"] == "dataset_processing"
    assert result["artifact"]["storage_key"].startswith("jobs/queue/high/")
    assert result["audit"]["status"] == "completed"


@pytest.mark.asyncio
async def test_registry_exposes_background_job_tool_for_long_running_prompts():
    registry = ToolRegistry()
    registry.jobs.storage = FakeStorage()

    suggestions = await registry.preflight("analysis", "Queue a long-running batch enrichment over this dataset.")

    assert any(suggestion["tool"] == "background_job" for suggestion in suggestions)
