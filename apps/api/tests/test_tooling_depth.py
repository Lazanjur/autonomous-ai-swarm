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


class FakeAsyncStream:
    def __init__(self, chunks: list[bytes]) -> None:
        self._chunks = list(chunks)

    async def read(self, size: int = -1) -> bytes:
        if not self._chunks:
            return b""
        return self._chunks.pop(0)


class FakeProcess:
    def __init__(
        self,
        command: list[str],
        *,
        stdout_chunks: list[bytes] | None = None,
        stderr_chunks: list[bytes] | None = None,
        returncode: int = 0,
        workspace_writer=None,
    ) -> None:
        self.command = command
        self.stdout = FakeAsyncStream(stdout_chunks or [])
        self.stderr = FakeAsyncStream(stderr_chunks or [])
        self.returncode = returncode
        self._workspace_writer = workspace_writer

    async def wait(self) -> int:
        if self._workspace_writer is not None:
            self._workspace_writer(self.command)
        return self.returncode

    def kill(self) -> None:
        self.returncode = -9


@pytest.mark.asyncio
async def test_sandbox_captures_generated_artifacts(monkeypatch):
    executor = DockerSandboxExecutor(storage=FakeStorage())

    async def fake_create_process(command):
        def write_result(current_command: list[str]) -> None:
            volume_flag_index = current_command.index("-v")
            workspace = current_command[volume_flag_index + 1].rsplit(":", 1)[0]
            from pathlib import Path

            Path(workspace, "result.txt").write_text("done", encoding="utf-8")

        return FakeProcess(
            command,
            stdout_chunks=[b"ok\n"],
            stderr_chunks=[],
            returncode=0,
            workspace_writer=write_result,
        )

    monkeypatch.setattr(executor, "_create_process", fake_create_process)

    result = await executor.execute_python("print('ok')")

    assert result["status"] == "completed"
    assert result["returncode"] == 0
    assert result["artifacts"][0]["relative_path"] == "result.txt"
    assert result["audit"]["status"] == "completed"
    assert result["stdout"] == "ok\n"
    assert result["session_events_emitted"] is True


@pytest.mark.asyncio
async def test_sandbox_streams_terminal_output_events(monkeypatch):
    executor = DockerSandboxExecutor(storage=FakeStorage())
    events: list[tuple[str, dict]] = []

    async def fake_create_process(command):
        return FakeProcess(
            command,
            stdout_chunks=[b"step 1\n", b"step 2\n"],
            stderr_chunks=[b"warn 1\n"],
            returncode=0,
        )

    async def capture(event: str, payload: dict) -> None:
        events.append((event, payload))

    monkeypatch.setattr(executor, "_create_process", fake_create_process)

    result = await executor.execute_python(
        "print('step 1')\nprint('step 2')",
        event_handler=capture,
        event_context={"agent_key": "coding", "step_index": 0},
    )

    assert result["status"] == "completed"
    assert result["stdout"] == "step 1\nstep 2\n"
    assert result["stderr"] == "warn 1\n"
    event_names = [name for name, _ in events]
    assert event_names[0] == "computer.session.started"
    assert event_names[-1] == "computer.session.completed"
    assert event_names.count("computer.session.updated") == 3
    assert event_names.count("terminal.stdout") == 2
    assert event_names.count("terminal.stderr") == 1
    stdout_deltas = [payload.get("stdout_delta") for name, payload in events if name == "terminal.stdout"]
    stderr_deltas = [payload.get("stderr_delta") for name, payload in events if name == "terminal.stderr"]
    assert stdout_deltas == ["step 1\n", "step 2\n"]
    assert stderr_deltas == ["warn 1\n"]
    assert events[-1][1]["session_kind"] == "terminal"


@pytest.mark.asyncio
async def test_registry_emits_tool_output_and_artifact_events():
    registry = ToolRegistry()
    fake_storage = FakeStorage()
    registry.document.storage = fake_storage

    events: list[tuple[str, dict]] = []

    async def capture(event: str, payload: dict) -> None:
        events.append((event, payload))

    result = await registry.execute_named(
        "content",
        "document_export",
        {
            "mode": "markdown",
            "title": "launch-brief",
            "content": "Ship the launch brief.",
        },
        event_handler=capture,
        event_context={"agent_key": "content", "step_index": 0},
    )

    assert result["status"] == "completed"
    assert [name for name, _ in events] == [
        "tool.started",
        "tool.output",
        "tool.completed",
        "artifact.created",
    ]
    assert events[1][1]["tool"] == "document_export"
    assert "artifact" in events[-1][1]


@pytest.mark.asyncio
async def test_registry_emits_workspace_activity_for_file_focus():
    registry = ToolRegistry()

    events: list[tuple[str, dict]] = []

    async def capture(event: str, payload: dict) -> None:
        events.append((event, payload))

    result = await registry.execute_named(
        "coding",
        "workspace_files",
        {
            "action": "read_text",
            "relative_path": "README.md",
        },
        event_handler=capture,
        event_context={"agent_key": "coding", "agent_name": "Coding Agent", "step_index": 0},
    )

    assert result["status"] == "completed"
    workspace_events = [payload for name, payload in events if name == "workspace.activity"]
    assert len(workspace_events) == 1
    assert workspace_events[0]["operation"] == "read_text"
    assert workspace_events[0]["relative_path"] == "README.md"
    assert workspace_events[0]["target_kind"] == "file"


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
