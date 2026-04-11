from __future__ import annotations

from dataclasses import asdict, dataclass

from app.services.tools.document import DocumentExportTool
from app.services.tools.filesystem import WorkspaceFilesystemTool
from app.services.tools.browser import BrowserAutomationTool
from app.services.tools.jobs import BackgroundJobTool
from app.services.tools.notifications import NotificationDispatchTool
from app.services.tools.research import WebResearchTool
from app.services.tools.sandbox import DockerSandboxExecutor


@dataclass(frozen=True)
class ToolDescriptor:
    name: str
    description: str
    allowed_agents: tuple[str, ...]


class ToolRegistry:
    def __init__(self) -> None:
        self.research = WebResearchTool()
        self.sandbox = DockerSandboxExecutor()
        self.browser = BrowserAutomationTool()
        self.document = DocumentExportTool()
        self.filesystem = WorkspaceFilesystemTool()
        self.notifications = NotificationDispatchTool()
        self.jobs = BackgroundJobTool()
        self.descriptors = [
            ToolDescriptor(
                name="web_search",
                description="Look up public information and capture source links.",
                allowed_agents=("research", "analysis"),
            ),
            ToolDescriptor(
                name="python_sandbox",
                description="Execute Python code inside an isolated Docker sandbox.",
                allowed_agents=("analysis", "coding"),
            ),
            ToolDescriptor(
                name="browser_automation",
                description="Execute Playwright browser sessions with captured page state and approved UI actions.",
                allowed_agents=("vision_automation", "research"),
            ),
            ToolDescriptor(
                name="document_export",
                description="Persist report bundles, markdown, JSON, CSV, and spreadsheet artifacts to storage.",
                allowed_agents=("content", "analysis", "coding"),
            ),
            ToolDescriptor(
                name="workspace_files",
                description="Read workspace files and write tool outputs inside the allowed policy boundary.",
                allowed_agents=("coding", "analysis"),
            ),
            ToolDescriptor(
                name="notification_dispatch",
                description="Queue email, Slack, or webhook notifications with durable outbox records and audit trails.",
                allowed_agents=("content", "vision_automation", "analysis"),
            ),
            ToolDescriptor(
                name="background_jobs",
                description="Queue long-running work into durable job records for later processing and auditability.",
                allowed_agents=("analysis", "coding", "vision_automation"),
            ),
        ]

    def list_for_agent(self, agent_key: str) -> list[dict]:
        return [asdict(tool) for tool in self.descriptors if agent_key in tool.allowed_agents]

    async def preflight(self, agent_key: str, prompt: str) -> list[dict]:
        suggestions: list[dict] = []
        lowered = prompt.lower()
        wants_background = any(
            token in lowered for token in ("background", "long-running", "long running", "async", "batch", "bulk", "queue")
        )
        if agent_key == "research":
            suggestions.append(await self.research.execute(prompt, max_results=3))
        elif agent_key == "coding":
            if "python" in lowered or "code" in lowered or "script" in lowered:
                suggestions.append(
                    await self.sandbox.execute_python(
                        "from pathlib import Path\nPath('sandbox-ready.txt').write_text('ready', encoding='utf-8')\nprint('Sandbox preflight ready for orchestration tasks.')"
                    )
                )
            suggestions.append(await self.filesystem.list_files())
            suggestions.append(await self.filesystem.describe_policies())
            if wants_background:
                suggestions.append(await self.jobs.preview(prompt))
        elif agent_key == "content":
            suggestions.append(await self.document.export_markdown("draft-outline", "Artifact scaffold ready."))
            if any(token in lowered for token in ("csv", "spreadsheet", "table", "xlsx")):
                suggestions.append(
                    await self.document.export_table(
                        "report-table-scaffold",
                        rows=[{"column": "example", "value": "ready"}],
                        format="csv",
                    )
                )
        elif agent_key == "vision_automation":
            suggestions.append(await self.browser.execute(prompt))
            if wants_background:
                suggestions.append(await self.jobs.preview(prompt))
        elif agent_key == "analysis":
            if any(token in lowered for token in ("webhook", "slack", "email", "notify")):
                suggestions.append(await self.notifications.preview_dispatch(prompt))
            if wants_background:
                suggestions.append(await self.jobs.preview(prompt))
        return suggestions
