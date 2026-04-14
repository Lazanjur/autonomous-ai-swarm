from __future__ import annotations
from collections.abc import Awaitable, Callable
from dataclasses import asdict, dataclass
from typing import Any

from app.services.tools.document import DocumentExportTool
from app.services.tools.filesystem import WorkspaceFilesystemTool
from app.services.tools.browser import BrowserAutomationTool
from app.services.tools.jobs import BackgroundJobTool
from app.services.tools.integrations import ExternalIntegrationTool
from app.services.tools.notebooklm import NotebookLMStudioTool
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
        self.integrations = ExternalIntegrationTool()
        self.jobs = BackgroundJobTool()
        self.notebooklm = NotebookLMStudioTool()
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
                name="notebooklm_studio",
                description="Use NotebookLM for native deliverables such as podcasts, videos, slide decks, quizzes, flashcards, reports, mind maps, infographics, and data tables.",
                allowed_agents=("content", "analysis"),
            ),
            ToolDescriptor(
                name="workspace_files",
                description="Read workspace files and write tool outputs inside the allowed policy boundary.",
                allowed_agents=("coding", "analysis"),
            ),
            ToolDescriptor(
                name="notification_dispatch",
                description="Queue or deliver email, Slack, and webhook notifications with approval-aware audit trails.",
                allowed_agents=("content", "vision_automation", "analysis"),
            ),
            ToolDescriptor(
                name="external_integrations",
                description="Deliver email, Slack, webhooks, calendar events, and generic REST calls to external systems.",
                allowed_agents=("content", "vision_automation", "analysis", "coding"),
            ),
            ToolDescriptor(
                name="background_jobs",
                description="Queue long-running work into durable job records for later processing and auditability.",
                allowed_agents=("analysis", "coding", "vision_automation"),
            ),
        ]

    def list_for_agent(self, agent_key: str) -> list[dict]:
        return [asdict(tool) for tool in self.descriptors if agent_key in tool.allowed_agents]

    async def preflight(
        self,
        agent_key: str,
        prompt: str,
        *,
        event_handler: Callable[[str, dict[str, Any]], Awaitable[None]] | None = None,
        event_context: dict[str, Any] | None = None,
    ) -> list[dict]:
        suggestions: list[dict] = []
        lowered = prompt.lower()
        wants_background = any(
            token in lowered for token in ("background", "long-running", "long running", "async", "batch", "bulk", "queue")
        )
        if agent_key == "research":
            suggestions.append(
                await self._run_tool(
                    "web_search",
                    self.research.execute(prompt, max_results=3),
                    event_handler=event_handler,
                    event_context=event_context,
                )
            )
        elif agent_key == "coding":
            if "python" in lowered or "code" in lowered or "script" in lowered:
                suggestions.append(
                    await self._run_tool(
                        "python_sandbox",
                        self.sandbox.execute_python(
                            "from pathlib import Path\nPath('sandbox-ready.txt').write_text('ready', encoding='utf-8')\nprint('Sandbox preflight ready for orchestration tasks.')",
                            event_handler=event_handler,
                            event_context=event_context,
                        ),
                        event_handler=event_handler,
                        event_context=event_context,
                    )
                )
            suggestions.append(
                await self._run_tool(
                    "workspace_files",
                    self.filesystem.list_files(),
                    event_handler=event_handler,
                    event_context=event_context,
                )
            )
            suggestions.append(
                await self._run_tool(
                    "workspace_files",
                    self.filesystem.describe_policies(),
                    event_handler=event_handler,
                    event_context=event_context,
                )
            )
            if wants_background:
                suggestions.append(
                    await self._run_tool(
                        "background_jobs",
                        self.jobs.preview(prompt),
                        event_handler=event_handler,
                        event_context=event_context,
                    )
                )
        elif agent_key == "content":
            notebooklm_output = self.notebooklm.detect_output_type(prompt)
            if notebooklm_output:
                suggestions.append(
                    await self._run_tool(
                        "notebooklm_studio",
                        self.notebooklm.preview_request(
                            prompt,
                            output_type=notebooklm_output,
                        ),
                        event_handler=event_handler,
                        event_context=event_context,
                    )
                )
            else:
                suggestions.append(
                    await self._run_tool(
                        "document_export",
                        self.document.export_markdown("draft-outline", "Artifact scaffold ready."),
                        event_handler=event_handler,
                        event_context=event_context,
                    )
                )
                if any(token in lowered for token in ("csv", "spreadsheet", "table", "xlsx")):
                    suggestions.append(
                        await self._run_tool(
                            "document_export",
                            self.document.export_table(
                                "report-table-scaffold",
                                rows=[{"column": "example", "value": "ready"}],
                                format="csv",
                            ),
                            event_handler=event_handler,
                            event_context=event_context,
                        )
                    )
        elif agent_key == "vision_automation":
            suggestions.append(
                await self._run_tool(
                    "browser_automation",
                    self.browser.execute_with_events(
                        prompt,
                        event_handler=event_handler,
                        event_context=event_context,
                    ),
                    event_handler=event_handler,
                    event_context=event_context,
                )
            )
            if wants_background:
                suggestions.append(
                    await self._run_tool(
                        "background_jobs",
                        self.jobs.preview(prompt),
                        event_handler=event_handler,
                        event_context=event_context,
                    )
                )
        elif agent_key == "analysis":
            notebooklm_output = self.notebooklm.detect_output_type(prompt)
            if notebooklm_output:
                suggestions.append(
                    await self._run_tool(
                        "notebooklm_studio",
                        self.notebooklm.preview_request(
                            prompt,
                            output_type=notebooklm_output,
                        ),
                        event_handler=event_handler,
                        event_context=event_context,
                    )
                )
            if any(token in lowered for token in ("webhook", "slack", "email", "notify", "calendar", "integration", "crm", "api")):
                suggestions.append(
                    await self._run_tool(
                        "external_integrations",
                        self.integrations.preview_dispatch(prompt),
                        event_handler=event_handler,
                        event_context=event_context,
                    )
                )
            if wants_background:
                suggestions.append(
                    await self._run_tool(
                        "background_jobs",
                        self.jobs.preview(prompt),
                        event_handler=event_handler,
                        event_context=event_context,
                    )
                )
        return suggestions

    async def execute_named(
        self,
        agent_key: str,
        tool_name: str,
        arguments: dict[str, Any] | None = None,
        *,
        event_handler: Callable[[str, dict[str, Any]], Awaitable[None]] | None = None,
        event_context: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        descriptor = self._descriptor_for_agent(agent_key, tool_name)
        if descriptor is None:
            return await self._run_tool(
                tool_name,
                self._rejected_operation(
                    tool_name,
                    (
                        f"Tool `{tool_name}` is not available for agent `{agent_key}`. "
                        f"Allowed tools: {', '.join(tool['name'] for tool in self.list_for_agent(agent_key)) or 'none'}."
                    ),
                    payload={"arguments": arguments or {}},
                ),
                event_handler=event_handler,
                event_context=event_context,
            )

        return await self._run_tool(
            descriptor.name,
            self._dispatch_named_tool(
                descriptor.name,
                arguments or {},
                event_handler=event_handler,
                event_context=event_context,
            ),
            event_handler=event_handler,
            event_context=event_context,
        )

    def _descriptor_for_agent(self, agent_key: str, tool_name: str) -> ToolDescriptor | None:
        return next(
            (
                descriptor
                for descriptor in self.descriptors
                if descriptor.name == tool_name and agent_key in descriptor.allowed_agents
            ),
            None,
        )

    async def _dispatch_named_tool(
        self,
        tool_name: str,
        arguments: dict[str, Any],
        *,
        event_handler: Callable[[str, dict[str, Any]], Awaitable[None]] | None = None,
        event_context: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        try:
            if tool_name == "web_search":
                query = str(arguments.get("query") or arguments.get("prompt") or "").strip()
                if not query:
                    return await self._rejected_operation(
                        tool_name,
                        "web_search requires a non-empty `query` argument.",
                        payload={"arguments": arguments},
                    )
                return await self.research.execute(
                    query=query,
                    max_results=self._coerce_int(arguments.get("max_results"), default=5, minimum=1, maximum=10),
                )

            if tool_name == "python_sandbox":
                code = str(arguments.get("code") or "").strip()
                if not code:
                    return await self._rejected_operation(
                        tool_name,
                        "python_sandbox requires a `code` argument containing Python source.",
                        payload={"arguments": arguments},
                    )
                files = arguments.get("files")
                return await self.sandbox.execute_python(
                    code=code,
                    files=files if isinstance(files, dict) else None,
                    timeout_seconds=self._coerce_int(
                        arguments.get("timeout_seconds"),
                        default=20,
                        minimum=1,
                        maximum=120,
                    ),
                    event_handler=event_handler,
                    event_context=event_context,
                )

            if tool_name == "browser_automation":
                goal = str(arguments.get("goal") or arguments.get("prompt") or "").strip()
                if not goal:
                    return await self._rejected_operation(
                        tool_name,
                        "browser_automation requires a `goal` argument describing the browser task.",
                        payload={"arguments": arguments},
                    )
                return await self.browser.execute_with_events(
                    goal,
                    event_handler=event_handler,
                    event_context=event_context,
                )

            if tool_name == "document_export":
                mode = str(arguments.get("mode") or "markdown").strip().lower()
                title = str(arguments.get("title") or "generated-artifact").strip() or "generated-artifact"
                if mode == "markdown":
                    return await self.document.export_markdown(
                        title=title,
                        content=str(arguments.get("content") or "").strip(),
                        metadata=arguments.get("metadata") if isinstance(arguments.get("metadata"), dict) else None,
                    )
                if mode == "json":
                    payload = arguments.get("payload")
                    if payload is None:
                        payload = {"content": arguments.get("content")}
                    return await self.document.export_json(title=title, payload=payload)
                if mode == "table":
                    rows = arguments.get("rows")
                    if not isinstance(rows, list):
                        return await self._rejected_operation(
                            tool_name,
                            "document_export table mode requires a `rows` list.",
                            payload={"arguments": arguments},
                        )
                    return await self.document.export_table(
                        title=title,
                        rows=[row for row in rows if isinstance(row, dict)],
                        format=str(arguments.get("format") or "csv").strip().lower(),
                    )
                if mode == "report_bundle":
                    sections = arguments.get("sections")
                    if not isinstance(sections, list):
                        return await self._rejected_operation(
                            tool_name,
                            "document_export report_bundle mode requires a `sections` list.",
                            payload={"arguments": arguments},
                        )
                    return await self.document.export_report_bundle(
                        title=title,
                        sections=[section for section in sections if isinstance(section, dict)],
                        table_rows=arguments.get("table_rows")
                        if isinstance(arguments.get("table_rows"), list)
                        else None,
                        metadata=arguments.get("metadata") if isinstance(arguments.get("metadata"), dict) else None,
                    )
                return await self._rejected_operation(
                    tool_name,
                    f"Unsupported document_export mode `{mode}`.",
                    payload={"arguments": arguments},
                )

            if tool_name == "notebooklm_studio":
                action = str(arguments.get("action") or "preview_request").strip().lower()
                if action == "capabilities":
                    return await self.notebooklm.capabilities()
                if action == "preview_request":
                    return await self.notebooklm.preview_request(
                        prompt=str(arguments.get("prompt") or ""),
                        output_type=str(arguments.get("output_type") or "").strip() or None,
                    )
                if action == "generate_deliverable":
                    source_urls = arguments.get("source_urls")
                    source_paths = arguments.get("source_paths")
                    return await self.notebooklm.generate_deliverable(
                        prompt=str(arguments.get("prompt") or ""),
                        output_type=str(arguments.get("output_type") or "").strip() or None,
                        notebook_name=str(arguments.get("notebook_name") or "").strip() or None,
                        title=str(arguments.get("title") or "").strip() or None,
                        instructions=str(arguments.get("instructions") or "").strip() or None,
                        source_urls=[
                            str(item).strip()
                            for item in source_urls
                            if str(item).strip()
                        ]
                        if isinstance(source_urls, list)
                        else None,
                        source_paths=[
                            str(item).strip()
                            for item in source_paths
                            if str(item).strip()
                        ]
                        if isinstance(source_paths, list)
                        else None,
                        source_bundle_text=str(arguments.get("source_bundle_text") or "").strip() or None,
                        output_format=str(arguments.get("output_format") or "").strip() or None,
                        language=str(arguments.get("language") or "").strip() or None,
                    )
                return await self._rejected_operation(
                    tool_name,
                    f"Unsupported notebooklm_studio action `{action}`.",
                    payload={"arguments": arguments},
                )

            if tool_name == "workspace_files":
                action = str(arguments.get("action") or "list_files").strip().lower()
                if action == "describe_policies":
                    return await self.filesystem.describe_policies()
                if action == "list_files":
                    return await self.filesystem.list_files(
                        relative_path=str(arguments.get("relative_path") or "."),
                        recursive=self._coerce_bool(arguments.get("recursive"), default=False),
                    )
                if action == "read_text":
                    relative_path = str(arguments.get("relative_path") or "").strip()
                    if not relative_path:
                        return await self._rejected_operation(
                            tool_name,
                            "workspace_files read_text requires a `relative_path` argument.",
                            payload={"arguments": arguments},
                        )
                    return await self.filesystem.read_text(
                        relative_path=relative_path,
                        max_chars=self._coerce_int(arguments.get("max_chars"), default=12000, minimum=200, maximum=50000),
                    )
                if action == "write_text":
                    relative_path = str(arguments.get("relative_path") or "").strip()
                    if not relative_path:
                        return await self._rejected_operation(
                            tool_name,
                            "workspace_files write_text requires a `relative_path` argument.",
                            payload={"arguments": arguments},
                        )
                    return await self.filesystem.write_text(
                        relative_path=relative_path,
                        content=str(arguments.get("content") or ""),
                        overwrite=self._coerce_bool(arguments.get("overwrite"), default=False),
                    )
                if action == "write_json":
                    relative_path = str(arguments.get("relative_path") or "").strip()
                    payload = arguments.get("payload")
                    if not relative_path:
                        return await self._rejected_operation(
                            tool_name,
                            "workspace_files write_json requires a `relative_path` argument.",
                            payload={"arguments": arguments},
                        )
                    if not isinstance(payload, (dict, list)):
                        return await self._rejected_operation(
                            tool_name,
                            "workspace_files write_json requires a `payload` object or list.",
                            payload={"arguments": arguments},
                        )
                    return await self.filesystem.write_json(
                        relative_path=relative_path,
                        payload=payload,
                        overwrite=self._coerce_bool(arguments.get("overwrite"), default=False),
                    )
                return await self._rejected_operation(
                    tool_name,
                    f"Unsupported workspace_files action `{action}`.",
                    payload={"arguments": arguments},
                )

            if tool_name == "notification_dispatch":
                action = str(arguments.get("action") or "preview_dispatch").strip().lower()
                if action == "preview_dispatch":
                    return await self.notifications.preview_dispatch(str(arguments.get("prompt") or ""))
                if action == "queue_email":
                    return await self.notifications.queue_email(
                        to=str(arguments.get("to") or ""),
                        subject=str(arguments.get("subject") or ""),
                        body=str(arguments.get("body") or ""),
                        deliver=self._coerce_bool(arguments.get("deliver"), default=False),
                        approval_note=str(arguments.get("approval_note") or "").strip() or None,
                    )
                if action == "queue_slack":
                    return await self.notifications.queue_slack(
                        channel=str(arguments.get("channel") or ""),
                        text=str(arguments.get("text") or ""),
                        webhook_url=str(arguments.get("webhook_url") or "").strip() or None,
                        deliver=self._coerce_bool(arguments.get("deliver"), default=False),
                        approval_note=str(arguments.get("approval_note") or "").strip() or None,
                    )
                if action == "send_webhook":
                    payload = arguments.get("payload")
                    if not isinstance(payload, dict):
                        return await self._rejected_operation(
                            tool_name,
                            "notification_dispatch send_webhook requires a `payload` object.",
                            payload={"arguments": arguments},
                        )
                    return await self.notifications.send_webhook(
                        url=str(arguments.get("url") or ""),
                        payload=payload,
                        headers=arguments.get("headers") if isinstance(arguments.get("headers"), dict) else None,
                        deliver=self._coerce_bool(arguments.get("deliver"), default=False),
                        approval_note=str(arguments.get("approval_note") or "").strip() or None,
                    )
                return await self._rejected_operation(
                    tool_name,
                    f"Unsupported notification_dispatch action `{action}`.",
                    payload={"arguments": arguments},
                )

            if tool_name == "external_integrations":
                action = str(arguments.get("action") or "integration_status").strip().lower()
                if action == "integration_status":
                    return await self.integrations.integration_status()
                if action == "preview_dispatch":
                    return await self.integrations.preview_dispatch(str(arguments.get("prompt") or ""))
                if action == "send_email":
                    return await self.integrations.send_email(
                        to=str(arguments.get("to") or ""),
                        subject=str(arguments.get("subject") or ""),
                        body=str(arguments.get("body") or ""),
                        deliver=self._coerce_bool(arguments.get("deliver"), default=False),
                        approval_note=str(arguments.get("approval_note") or "").strip() or None,
                    )
                if action == "send_slack":
                    return await self.integrations.send_slack(
                        channel=str(arguments.get("channel") or ""),
                        text=str(arguments.get("text") or ""),
                        webhook_url=str(arguments.get("webhook_url") or "").strip() or None,
                        deliver=self._coerce_bool(arguments.get("deliver"), default=False),
                        approval_note=str(arguments.get("approval_note") or "").strip() or None,
                        blocks=[item for item in arguments.get("blocks", []) if isinstance(item, dict)]
                        if isinstance(arguments.get("blocks"), list)
                        else None,
                    )
                if action == "send_webhook":
                    payload = arguments.get("payload")
                    if not isinstance(payload, dict):
                        return await self._rejected_operation(
                            tool_name,
                            "external_integrations send_webhook requires a `payload` object.",
                            payload={"arguments": arguments},
                        )
                    return await self.integrations.send_webhook(
                        url=str(arguments.get("url") or ""),
                        payload=payload,
                        headers=arguments.get("headers") if isinstance(arguments.get("headers"), dict) else None,
                        deliver=self._coerce_bool(arguments.get("deliver"), default=False),
                        approval_note=str(arguments.get("approval_note") or "").strip() or None,
                    )
                if action == "create_calendar_event":
                    attendees = arguments.get("attendees")
                    return await self.integrations.create_calendar_event(
                        title=str(arguments.get("title") or ""),
                        start_at=str(arguments.get("start_at") or ""),
                        end_at=str(arguments.get("end_at") or ""),
                        description=str(arguments.get("description") or "").strip() or None,
                        location=str(arguments.get("location") or "").strip() or None,
                        attendees=[str(item).strip() for item in attendees if str(item).strip()] if isinstance(attendees, list) else None,
                        deliver=self._coerce_bool(arguments.get("deliver"), default=False),
                        approval_note=str(arguments.get("approval_note") or "").strip() or None,
                        calendar_id=str(arguments.get("calendar_id") or "").strip() or None,
                    )
                if action == "invoke_endpoint":
                    payload = arguments.get("payload")
                    return await self.integrations.invoke_endpoint(
                        url=str(arguments.get("url") or ""),
                        method=str(arguments.get("method") or "POST").upper(),
                        payload=payload if isinstance(payload, dict) else None,
                        headers=arguments.get("headers") if isinstance(arguments.get("headers"), dict) else None,
                        deliver=self._coerce_bool(arguments.get("deliver"), default=False),
                        approval_note=str(arguments.get("approval_note") or "").strip() or None,
                    )
                return await self._rejected_operation(
                    tool_name,
                    f"Unsupported external_integrations action `{action}`.",
                    payload={"arguments": arguments},
                )

            if tool_name == "background_jobs":
                action = str(arguments.get("action") or "preview").strip().lower()
                if action == "preview":
                    return await self.jobs.preview(str(arguments.get("prompt") or ""))
                if action == "enqueue":
                    payload = arguments.get("payload")
                    if not isinstance(payload, dict):
                        return await self._rejected_operation(
                            tool_name,
                            "background_jobs enqueue requires a `payload` object.",
                            payload={"arguments": arguments},
                        )
                    return await self.jobs.enqueue(
                        job_type=str(arguments.get("job_type") or "background_task"),
                        payload=payload,
                        priority=str(arguments.get("priority") or "normal"),
                    )
                return await self._rejected_operation(
                    tool_name,
                    f"Unsupported background_jobs action `{action}`.",
                    payload={"arguments": arguments},
                )
        except Exception as exc:
            return await self._rejected_operation(
                tool_name,
                f"{exc.__class__.__name__}: {exc}",
                payload={"arguments": arguments},
            )

        return await self._rejected_operation(
            tool_name,
            f"Unsupported tool `{tool_name}`.",
            payload={"arguments": arguments},
        )

    async def _rejected_operation(
        self,
        tool_name: str,
        error: str,
        *,
        payload: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        return {
            "tool": tool_name,
            "operation": "execute",
            "status": "failed",
            **(payload or {}),
            "error": error,
            "audit": {
                "tool": tool_name,
                "operation": "execute",
                "status": "failed",
                "response": payload or {},
                "error": error,
                "storage_key": None,
                "path": None,
            },
        }

    def _coerce_int(
        self,
        value: Any,
        *,
        default: int,
        minimum: int | None = None,
        maximum: int | None = None,
    ) -> int:
        try:
            parsed = int(value)
        except (TypeError, ValueError):
            parsed = default
        if minimum is not None:
            parsed = max(minimum, parsed)
        if maximum is not None:
            parsed = min(maximum, parsed)
        return parsed

    def _coerce_bool(self, value: Any, *, default: bool) -> bool:
        if isinstance(value, bool):
            return value
        if value is None:
            return default
        if isinstance(value, str):
            lowered = value.strip().lower()
            if lowered in {"true", "1", "yes", "y", "on"}:
                return True
            if lowered in {"false", "0", "no", "n", "off"}:
                return False
        return bool(value)

    async def _run_tool(
        self,
        declared_name: str,
        operation: Awaitable[dict[str, Any]],
        *,
        event_handler: Callable[[str, dict[str, Any]], Awaitable[None]] | None,
        event_context: dict[str, Any] | None,
    ) -> dict[str, Any]:
        await self._emit(
            event_handler,
            "tool.started",
            {
                **(event_context or {}),
                "tool": declared_name,
                "status": "running",
            },
        )
        result = await operation
        tool_name = result.get("tool", declared_name)
        payload = {
            **(event_context or {}),
            "tool": tool_name,
            "operation": result.get("operation"),
            "status": result.get("status", "completed"),
            "summary": self._tool_summary(result),
            "result": result,
        }
        await self._emit(
            event_handler,
            "tool.output",
            {
                **(event_context or {}),
                "tool": tool_name,
                "operation": result.get("operation"),
                "status": result.get("status", "completed"),
                "summary": self._tool_summary(result),
                "output_preview": self._tool_output_preview(result),
                "artifacts": self._extract_artifacts(result),
                "metrics": result.get("metrics") if isinstance(result.get("metrics"), dict) else None,
            },
        )
        workspace_activity = self._workspace_activity(tool_name, result, event_context)
        if workspace_activity is not None:
            await self._emit(event_handler, "workspace.activity", workspace_activity)
        await self._emit(event_handler, "tool.completed", payload)

        for artifact in self._extract_artifacts(result):
            await self._emit(
                event_handler,
                "artifact.created",
                {
                    **(event_context or {}),
                    "tool": tool_name,
                    "status": result.get("status", "completed"),
                    "artifact": artifact,
                },
            )

        terminal_session = self._terminal_session(tool_name, result, event_context)
        if terminal_session and not result.get("session_events_emitted"):
            await self._emit(event_handler, "computer.session.completed", terminal_session)

        return result

    def _extract_artifacts(self, result: dict[str, Any]) -> list[dict[str, Any]]:
        artifacts: list[dict[str, Any]] = []
        payload = result.get("artifacts")
        if isinstance(payload, dict):
            artifacts.extend(
                artifact for artifact in payload.values() if isinstance(artifact, dict)
            )
        elif isinstance(payload, list):
            artifacts.extend(artifact for artifact in payload if isinstance(artifact, dict))

        for key in ("artifact", "outbox"):
            artifact = result.get(key)
            if isinstance(artifact, dict):
                artifacts.append(artifact)

        audit = result.get("audit")
        if isinstance(audit, dict):
            audit_artifacts = audit.get("artifacts")
            if isinstance(audit_artifacts, list):
                artifacts.extend(
                    artifact for artifact in audit_artifacts if isinstance(artifact, dict)
                )

        deduped: list[dict[str, Any]] = []
        seen: set[str] = set()
        for artifact in artifacts:
            storage_key = artifact.get("storage_key")
            if isinstance(storage_key, str):
                if storage_key in seen:
                    continue
                seen.add(storage_key)
            deduped.append(artifact)
        return deduped

    def _terminal_session(
        self,
        tool_name: str,
        result: dict[str, Any],
        event_context: dict[str, Any] | None,
    ) -> dict[str, Any] | None:
        if tool_name != "python_sandbox":
            return None
        return {
            **(event_context or {}),
            "session_kind": "terminal",
            "tool": tool_name,
            "status": result.get("status", "completed"),
            "command": result.get("command", []),
            "stdout": result.get("stdout", ""),
            "stderr": result.get("stderr", ""),
            "returncode": result.get("returncode"),
            "timed_out": result.get("timed_out", False),
            "artifacts": self._extract_artifacts(result),
        }

    def _tool_summary(self, result: dict[str, Any]) -> str:
        tool_name = str(result.get("tool", "tool"))
        operation = str(result.get("operation", "execute"))
        status = str(result.get("status", "completed"))
        if tool_name == "browser_automation":
            final_url = result.get("final_url") or result.get("target_url") or "browser session"
            return f"{operation} {status}: {final_url}"
        if tool_name == "python_sandbox":
            return (
                f"{operation} {status}: return code {result.get('returncode', 'n/a')}"
            )
        if tool_name == "document_export":
            return f"{operation} {status}: {len(self._extract_artifacts(result))} artifact(s)"
        if tool_name == "web_search":
            return f"{operation} {status}: {len(result.get('results', []))} result(s)"
        if tool_name == "workspace_files":
            target = str(result.get("relative_path") or result.get("path") or "workspace")
            if operation == "read_text":
                return f"{operation} {status}: {target}"
            if operation == "list_files":
                entry_count = len(result.get("entries", [])) if isinstance(result.get("entries"), list) else 0
                return f"{operation} {status}: {target} ({entry_count} entries)"
            if operation in {"write_text", "write_json"}:
                return f"{operation} {status}: {target}"
            if operation == "describe_policies":
                return f"{operation} {status}: workspace read/write policy"
            return f"{operation} {status}: {target}"
        if tool_name == "background_job":
            return f"{operation} {status}: {result.get('job_type', 'background task')}"
        if tool_name == "notification_dispatch":
            return f"{operation} {status}: {result.get('channel', 'notification')}"
        return f"{tool_name} {operation} {status}"

    def _tool_output_preview(self, result: dict[str, Any], limit: int = 280) -> str:
        tool_name = str(result.get("tool", "tool"))
        if tool_name == "web_search":
            results = result.get("results")
            if isinstance(results, list) and results:
                first = results[0] if isinstance(results[0], dict) else {}
                title = first.get("title") if isinstance(first, dict) else None
                return self._compact(str(title or f"{len(results)} result(s) captured"), limit)
        if tool_name == "python_sandbox":
            preview = str(result.get("stdout") or result.get("stderr") or "")
            return self._compact(preview or self._tool_summary(result), limit)
        if tool_name == "browser_automation":
            text = str(result.get("extracted_text") or result.get("final_url") or result.get("target_url") or "")
            return self._compact(text or self._tool_summary(result), limit)
        if tool_name == "workspace_files":
            preview = result.get("content")
            if isinstance(preview, str):
                return self._compact(preview, limit)
            entries = result.get("entries")
            if isinstance(entries, list):
                return self._compact(", ".join(str(entry.get("relative_path")) for entry in entries[:5] if isinstance(entry, dict)), limit)
            relative_path = result.get("relative_path")
            if isinstance(relative_path, str):
                return self._compact(relative_path, limit)
        return self._compact(str(result), limit)

    def _workspace_activity(
        self,
        tool_name: str,
        result: dict[str, Any],
        event_context: dict[str, Any] | None,
    ) -> dict[str, Any] | None:
        if tool_name != "workspace_files":
            return None

        operation = str(result.get("operation", "execute"))
        relative_path_value = result.get("relative_path")
        relative_path = (
            str(relative_path_value).strip()
            if isinstance(relative_path_value, str) and str(relative_path_value).strip()
            else None
        )
        entry_paths: list[str] = []
        entries = result.get("entries")
        if isinstance(entries, list):
            entry_paths = [
                str(entry.get("relative_path"))
                for entry in entries[:12]
                if isinstance(entry, dict) and isinstance(entry.get("relative_path"), str)
            ]

        directory_path: str | None = None
        target_kind = "workspace"
        if operation == "list_files":
            directory_path = relative_path or "."
            target_kind = "dir"
        elif relative_path:
            directory_path = relative_path.rsplit("/", 1)[0] if "/" in relative_path else "."
            target_kind = "file"

        return {
            **(event_context or {}),
            "tool": tool_name,
            "operation": operation,
            "status": str(result.get("status", "completed")),
            "relative_path": relative_path,
            "directory_path": directory_path,
            "target_kind": target_kind,
            "summary": self._tool_summary(result),
            "entry_paths": entry_paths,
        }

    def _compact(self, value: str, limit: int) -> str:
        compact = " ".join(value.split())
        return compact[:limit] + ("..." if len(compact) > limit else "")

    async def _emit(
        self,
        event_handler: Callable[[str, dict[str, Any]], Awaitable[None]] | None,
        event: str,
        payload: dict[str, Any],
    ) -> None:
        if event_handler is not None:
            await event_handler(event, payload)
