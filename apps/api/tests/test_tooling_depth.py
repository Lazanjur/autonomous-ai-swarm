import pytest

from app.services.tools.document import DocumentExportTool
from app.services.tools.filesystem import WorkspaceFilesystemTool
from app.services.tools.jobs import BackgroundJobTool
from app.services.tools.notebooklm import NotebookLMStudioTool
from app.services.tools.notifications import NotificationDispatchTool
from app.services.tools.research import WebResearchTool
from app.services.tools.registry import ToolRegistry
from app.services.tools.sandbox import DockerSandboxExecutor
from app.services.tools.visualization import VisualizationDocumentationTool
from app.services.task_templates import list_task_templates


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


def test_registry_exposes_visualization_docs_to_ui_diagram_agent():
    registry = ToolRegistry()

    tools = registry.list_for_agent("ui_diagram")

    assert any(tool["name"] == "visualization_docs" for tool in tools)


def test_registry_exposes_engineering_tools_to_tester_agent():
    registry = ToolRegistry()

    tools = {tool["name"] for tool in registry.list_for_agent("tester")}

    assert {"shell_sandbox", "workspace_files", "python_sandbox"}.issubset(tools)


def test_task_templates_include_premium_differentiator_workflows():
    templates = {template["key"] for template in list_task_templates()}

    assert {"autonomous_app_builder", "live_debugging_assistant", "team_delivery_swarm"}.issubset(templates)


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
async def test_sandbox_executes_shell_commands_inside_runtime(monkeypatch):
    executor = DockerSandboxExecutor(storage=FakeStorage())

    async def fake_create_process(command):
        return FakeProcess(
            command,
            stdout_chunks=[b"installed\n"],
            stderr_chunks=[],
            returncode=0,
        )

    monkeypatch.setattr(executor, "_create_process", fake_create_process)

    result = await executor.execute_command(
        "npm test",
        files={"package.json": '{"name":"demo"}'},
        network_access=False,
    )

    assert result["status"] == "completed"
    assert result["command"][-3:] == ["/bin/sh", "-lc", "npm test"]
    assert result["image"] == "node:20-bookworm-slim"
    assert result["stdout"] == "installed\n"


@pytest.mark.asyncio
async def test_sandbox_supports_windows_profile_with_powershell(monkeypatch):
    executor = DockerSandboxExecutor(storage=FakeStorage())

    async def fake_create_process(command):
        return FakeProcess(
            command,
            stdout_chunks=[b"done\n"],
            stderr_chunks=[],
            returncode=0,
        )

    monkeypatch.setattr(executor, "_create_process", fake_create_process)

    result = await executor.execute_command(
        "Get-ChildItem",
        execution_environment={
            "target_os": "windows",
            "runtime_profile": "powershell",
            "resource_tier": "medium",
        },
        network_access=False,
    )

    assert result["status"] == "completed"
    assert result["execution_environment"]["target_os"] == "windows"
    assert result["execution_environment"]["compatibility_mode"] == "compatibility"
    assert result["execution_environment"]["shell_family"] == "powershell"
    assert result["command"][-4:] == ["pwsh", "-NoLogo", "-NonInteractive", "-Command", "Get-ChildItem"][-4:]


@pytest.mark.asyncio
async def test_sandbox_describes_execution_environment_capabilities():
    executor = DockerSandboxExecutor(storage=FakeStorage())

    result = await executor.describe_capabilities()

    assert result["status"] == "completed"
    assert result["runner_backend"] == "docker"
    assert {item["target_os"] for item in result["supported_target_os"]} == {"linux", "windows", "macos"}
    assert any(item["name"] == "gpu" for item in result["resource_tiers"])


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
async def test_registry_executes_shell_sandbox_commands(monkeypatch):
    registry = ToolRegistry()

    async def fake_execute_command(**kwargs):
        return {
            "tool": "shell_sandbox",
            "operation": "execute_command",
            "status": "completed",
            "command": ["/bin/sh", "-lc", kwargs["command"]],
            "stdout": "tests passed",
            "stderr": "",
            "returncode": 0,
            "session_events_emitted": True,
            "artifacts": [],
        }

    monkeypatch.setattr(registry.sandbox, "execute_command", fake_execute_command)

    result = await registry.execute_named(
        "coding",
        "shell_sandbox",
        {"command": "pytest -q", "network_access": False},
    )

    assert result["status"] == "completed"
    assert result["tool"] == "shell_sandbox"
    assert result["stdout"] == "tests passed"


@pytest.mark.asyncio
async def test_registry_passes_execution_environment_to_shell_sandbox(monkeypatch):
    registry = ToolRegistry()

    async def fake_execute_command(**kwargs):
        return {
            "tool": "shell_sandbox",
            "operation": "execute_command",
            "status": "completed",
            "command": ["/bin/sh", "-lc", kwargs["command"]],
            "stdout": "tests passed",
            "stderr": "",
            "returncode": 0,
            "session_events_emitted": True,
            "artifacts": [],
            "execution_environment": kwargs.get("execution_environment"),
        }

    monkeypatch.setattr(registry.sandbox, "execute_command", fake_execute_command)

    result = await registry.execute_named(
        "coding",
        "shell_sandbox",
        {
            "command": "npm test",
            "execution_environment": {
                "target_os": "windows",
                "resource_tier": "large",
            },
        },
    )

    assert result["status"] == "completed"
    assert result["execution_environment"] == {
        "target_os": "windows",
        "resource_tier": "large",
    }


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
async def test_filesystem_suggests_related_files(tmp_path):
    tool = WorkspaceFilesystemTool()
    tool.root = tmp_path
    tool.write_root = (tmp_path / "var" / "tool-workspace").resolve()
    tool.write_root.mkdir(parents=True, exist_ok=True)

    src_dir = tmp_path / "src"
    src_dir.mkdir(parents=True, exist_ok=True)
    (src_dir / "widget.tsx").write_text('import "./widget.helpers"\n', encoding="utf-8")
    (src_dir / "widget.helpers.ts").write_text("export const helper = true\n", encoding="utf-8")
    (src_dir / "widget.test.tsx").write_text("describe('widget', () => {})\n", encoding="utf-8")
    (src_dir / "widget.css").write_text(".widget {}\n", encoding="utf-8")

    result = await tool.suggest_related_files("src/widget.tsx", max_results=4)

    assert result["status"] == "completed"
    related = result["related_files"]
    assert [item["relative_path"] for item in related[:3]] == [
        "src/widget.helpers.ts",
        "src/widget.test.tsx",
        "src/widget.css",
    ]


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
async def test_visualization_mockup_outputs_svg_and_spec():
    tool = VisualizationDocumentationTool(storage=FakeStorage())

    result = await tool.generate_mockup(
        prompt="Create a high-fidelity UI mockup for an executive analytics dashboard with KPIs and recent activity."
    )

    assert result["status"] == "completed"
    assert result["request_type"] == "mockup"
    storage_keys = [artifact["storage_key"] for artifact in result["artifacts"]]
    assert any(key.endswith("/mockup.svg") for key in storage_keys)
    assert any(key.endswith("/mockup-spec.json") for key in storage_keys)


@pytest.mark.asyncio
async def test_visualization_docs_bundle_outputs_document_pack():
    tool = VisualizationDocumentationTool(storage=FakeStorage())

    result = await tool.generate_docs_bundle(
        prompt="Create a README, API documentation, and onboarding guide for the autonomous swarm platform."
    )

    assert result["status"] == "completed"
    assert result["request_type"] == "docs_bundle"
    storage_keys = [artifact["storage_key"] for artifact in result["artifacts"]]
    assert any(key.endswith("/README.md") for key in storage_keys)
    assert any(key.endswith("/API-DOCS.md") for key in storage_keys)
    assert any(key.endswith("/ONBOARDING.md") for key in storage_keys)
    assert any(key.endswith("/bundle-manifest.json") for key in storage_keys)


@pytest.mark.asyncio
async def test_visualization_code_explanation_outputs_markdown_and_json():
    tool = VisualizationDocumentationTool(storage=FakeStorage())

    result = await tool.explain_code(
        code="def add(a, b):\n    return a + b\n",
        focus="Explain the function to a new teammate.",
    )

    assert result["status"] == "completed"
    assert result["request_type"] == "code_explanation"
    storage_keys = [artifact["storage_key"] for artifact in result["artifacts"]]
    assert any(key.endswith("/code-explanation.md") for key in storage_keys)
    assert any(key.endswith("/code-explanation.json") for key in storage_keys)


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


@pytest.mark.asyncio
async def test_registry_prefers_notebooklm_preview_for_native_deliverables():
    registry = ToolRegistry()

    suggestions = await registry.preflight(
        "content",
        "Create a podcast audio overview and flashcards from this research package.",
    )

    assert any(suggestion["tool"] == "notebooklm_studio" for suggestion in suggestions)
    assert all(suggestion["tool"] != "document_export" for suggestion in suggestions)


@pytest.mark.asyncio
async def test_registry_exposes_visualization_preview_for_mockup_requests():
    registry = ToolRegistry()

    suggestions = await registry.preflight(
        "content",
        "Create a high-fidelity UI mockup for the task execution dashboard.",
    )

    assert any(suggestion["tool"] == "visualization_docs" for suggestion in suggestions)


@pytest.mark.asyncio
async def test_registry_exposes_notebooklm_capabilities_without_install_requirement():
    registry = ToolRegistry()

    result = await registry.execute_named(
        "content",
        "notebooklm_studio",
        {"action": "capabilities"},
    )

    assert result["status"] == "completed"
    assert "audio_overview" in result["preferred_outputs"]


@pytest.mark.asyncio
async def test_notebooklm_uses_persistent_home_and_run_workspace(monkeypatch, tmp_path):
    import app.services.tools.notebooklm as notebooklm_module

    storage_root = tmp_path / "notebooklm-home"
    monkeypatch.setattr(notebooklm_module.settings, "notebooklm_storage_dir", str(storage_root))

    captured: dict[str, str | None] = {}

    class FakeClientClass:
        @staticmethod
        def from_storage(storage_dir: str | None = None):
            captured["storage_dir"] = storage_dir
            return {"storage_dir": storage_dir}

    class FakeModule:
        NotebookLMClient = FakeClientClass

    monkeypatch.setattr(notebooklm_module.importlib, "import_module", lambda _: FakeModule())

    tool = NotebookLMStudioTool()
    factory = tool._load_client_factory()
    result = await factory()

    assert tool.storage_root == storage_root.resolve()
    assert tool.run_workspace_root == storage_root.resolve() / "runs"
    assert tool.run_workspace_root.exists()
    assert captured["storage_dir"] == str(storage_root.resolve())
    assert result["storage_dir"] == str(storage_root.resolve())
    assert notebooklm_module.os.environ["NOTEBOOKLM_HOME"] == str(storage_root.resolve())


@pytest.mark.asyncio
async def test_web_research_batch_search_dedupes_and_assigns_citations(monkeypatch):
    tool = WebResearchTool(storage=FakeStorage())

    async def fake_search_query(query: str, *, max_results: int, verify_sources: bool, include_snippets: bool):
        if query == "competitor pricing":
            return [
                {
                    "title": "Alpha Pricing",
                    "url": "https://alpha.example/pricing",
                    "final_url": "https://alpha.example/pricing",
                    "verified": True,
                    "query": query,
                    "snippet": "Alpha pricing page",
                },
                {
                    "title": "Shared source",
                    "url": "https://shared.example/report",
                    "final_url": "https://shared.example/report",
                    "verified": True,
                    "query": query,
                    "snippet": "Shared industry report",
                },
            ]
        return [
            {
                "title": "Shared source",
                "url": "https://shared.example/report",
                "final_url": "https://shared.example/report",
                "verified": True,
                "query": query,
                "snippet": "Shared industry report",
            },
            {
                "title": "Beta Pricing",
                "url": "https://beta.example/pricing",
                "final_url": "https://beta.example/pricing",
                "verified": False,
                "query": query,
                "snippet": "Beta pricing page",
            },
        ]

    monkeypatch.setattr(tool, "_search_query", fake_search_query)

    result = await tool.execute_batch(
        ["competitor pricing", "market comparison"],
        max_results=3,
    )

    assert result["status"] == "completed"
    assert result["operation"] == "batch_search"
    assert len(result["groups"]) == 2
    assert len(result["results"]) == 3
    assert all(item["citation_id"].startswith("S") for item in result["results"])
    assert result["verified_count"] == 2


@pytest.mark.asyncio
async def test_web_research_extract_structured_exports_json_and_csv(monkeypatch):
    storage = FakeStorage()
    tool = WebResearchTool(storage=storage)

    async def fake_extract_rows(urls: list[str]):
        return [
            {
                "title": "Webhook Invest Business",
                "url": "https://www.webhook.investbusiness.com",
                "final_url": "https://www.webhook.investbusiness.com",
                "domain": "www.webhook.investbusiness.com",
                "verified": True,
                "status_code": 200,
                "content_type": "text/html",
                "description": "Webhook login surface",
                "snippet": "Admin panel",
                "headings": "Webhook Admin",
                "text_excerpt": "Admin login and webhook configuration.",
                "error": "",
            }
        ]

    monkeypatch.setattr(tool, "_extract_rows_from_urls", fake_extract_rows)

    result = await tool.extract_structured(
        ["https://www.webhook.investbusiness.com"],
        export_format="both",
        title="Webhook Extract",
    )

    assert result["status"] == "completed"
    assert result["operation"] == "extract_structured"
    assert result["row_count"] == 1
    assert len(result["artifacts"]) == 2
    assert any(artifact["storage_key"].endswith(".json") for artifact in result["artifacts"])
    assert any(artifact["storage_key"].endswith(".csv") for artifact in result["artifacts"])
    assert "research/webhook-extract.json" in storage.saved
    assert "research/webhook-extract.csv" in storage.saved


@pytest.mark.asyncio
async def test_registry_executes_web_research_pipeline_and_emits_artifacts(monkeypatch):
    registry = ToolRegistry()
    registry.research.storage = FakeStorage()

    async def fake_search_query(query: str, *, max_results: int, verify_sources: bool, include_snippets: bool):
        return [
            {
                "title": "Market source",
                "page_title": "Market source",
                "url": "https://market.example/source",
                "final_url": "https://market.example/source",
                "domain": "market.example",
                "verified": True,
                "query": query,
                "description": "Verified source",
                "snippet": "Verified source",
                "headings": ["Overview"],
                "text_excerpt": "Structured market source",
                "status_code": 200,
                "content_type": "text/html",
            }
        ]

    monkeypatch.setattr(registry.research, "_search_query", fake_search_query)

    result = await registry.execute_named(
        "research",
        "web_search",
        {
            "action": "build_pipeline",
            "query": "Extract competitor pricing into CSV",
            "export_format": "both",
        },
    )

    assert result["status"] == "completed"
    assert result["operation"] == "build_pipeline"
    assert len(result["rows"]) == 1
    assert len(result["artifacts"]) == 2
    assert result["citations"][0]["id"] == "S1"


@pytest.mark.asyncio
async def test_registry_research_preflight_prefers_pipeline_for_structured_requests(monkeypatch):
    registry = ToolRegistry()

    async def fake_build_pipeline(**kwargs):
        return {
            "tool": "web_search",
            "operation": "build_pipeline",
            "status": "completed",
            "queries": [kwargs.get("query")],
            "results": [],
            "rows": [{"title": "Structured row"}],
            "artifacts": [
                {
                    "storage_key": "research/structured-output.json",
                    "path": "/fake/research/structured-output.json",
                    "content_type": "application/json",
                }
            ],
            "audit": {"status": "completed"},
        }

    monkeypatch.setattr(registry.research, "build_pipeline", fake_build_pipeline)

    suggestions = await registry.preflight(
        "research",
        "Extract competitor pricing into CSV with verified sources.",
    )

    assert suggestions
    assert suggestions[0]["tool"] == "web_search"
    assert suggestions[0]["operation"] == "build_pipeline"
