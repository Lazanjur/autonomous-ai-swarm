from __future__ import annotations

import asyncio
from collections import defaultdict
from datetime import datetime, timedelta
import inspect
from pathlib import Path
import subprocess
from typing import Any, AsyncIterator

from sqlalchemy import desc, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.request_context import update_runtime_request_context
from app.models.entities import (
    Artifact,
    AuditLog,
    ChatThread,
    Document,
    Message,
    Project,
    Run,
    RunStep,
    ToolCall,
    Workspace,
    utc_now,
)
from app.schemas.chat import ChatRunRequest
from app.services.agents.registry import AGENT_CATALOG
from app.services.agents.orchestrator import SupervisorOrchestrator
from app.services.rag.retrieval import RetrievalFilters
from app.services.rag.service import KnowledgeService
from app.services.task_templates import get_task_template, list_task_templates
from app.services.tools.filesystem import WorkspaceFilesystemTool
from app.services.tools.registry import ToolRegistry

settings = get_settings()
TASK_CHECKLIST_START_MARKER = "<!-- SWARM_TASK_CHECKLIST_START -->"
TASK_CHECKLIST_END_MARKER = "<!-- SWARM_TASK_CHECKLIST_END -->"
SHARED_MEMORY_LIST_LIMIT = 8
SHARED_MEMORY_AGENT_LIMIT = 6


class RunService:
    def __init__(self) -> None:
        self.orchestrator = SupervisorOrchestrator()
        self.knowledge_service = KnowledgeService()
        self.filesystem = WorkspaceFilesystemTool()
        self.tools_registry = ToolRegistry()

    async def list_workspace_threads(
        self,
        session: AsyncSession,
        workspace_id,
    ) -> tuple[Workspace, list[ChatThread]]:
        workspace_result = await session.execute(select(Workspace).where(Workspace.id == workspace_id))
        workspace = workspace_result.scalar_one()
        result = await session.execute(
            select(ChatThread)
            .where(ChatThread.workspace_id == workspace.id)
            .order_by(desc(ChatThread.updated_at), desc(ChatThread.created_at))
        )
        threads = list(result.scalars().all())
        if not threads:
            thread = ChatThread(
                workspace_id=workspace.id,
                title="General assistant",
                status="active",
            )
            session.add(thread)
            await session.commit()
            await session.refresh(thread)
            threads = [thread]
        return workspace, threads

    async def list_workspace_projects(
        self,
        session: AsyncSession,
        workspace_id,
    ) -> list[Project]:
        result = await session.execute(
            select(Project)
            .where(Project.workspace_id == workspace_id)
            .order_by(desc(Project.updated_at), desc(Project.created_at))
        )
        return list(result.scalars().all())

    async def list_thread_runs(
        self,
        session: AsyncSession,
        thread_id,
        *,
        limit: int = 15,
    ) -> list[Run]:
        result = await session.execute(
            select(Run)
            .where(Run.thread_id == thread_id)
            .order_by(desc(Run.created_at))
            .limit(limit)
        )
        return list(result.scalars().all())

    async def get_messages(self, session: AsyncSession, thread_id) -> list[Message]:
        result = await session.execute(
            select(Message).where(Message.thread_id == thread_id).order_by(Message.created_at)
        )
        return list(result.scalars().all())

    async def get_chat_workspace(
        self,
        session: AsyncSession,
        *,
        workspace_id,
        thread_id=None,
        project_id=None,
        run_limit: int = 15,
    ) -> dict[str, Any]:
        workspace, threads = await self.list_workspace_threads(session, workspace_id)
        projects = await self.list_workspace_projects(session, workspace_id)
        self._ensure_metadata_aliases(threads)
        self._ensure_metadata_aliases(projects)
        selected_thread = None
        if thread_id is not None:
            selected_thread = next((thread for thread in threads if thread.id == thread_id), None)
        if selected_thread is None and project_id is not None:
            selected_thread = next((thread for thread in threads if thread.project_id == project_id), None)
        if selected_thread is None and threads and project_id is None:
            selected_thread = threads[0]
        selected_project = None
        if selected_thread is not None and selected_thread.project_id is not None:
            selected_project = next(
                (project for project in projects if project.id == selected_thread.project_id),
                None,
            )
        if selected_project is None and project_id is not None:
            selected_project = next((project for project in projects if project.id == project_id), None)

        thread_summaries = await self._build_thread_summaries(session, threads)
        messages = await self.get_messages(session, selected_thread.id) if selected_thread else []
        runs = await self.list_thread_runs(session, selected_thread.id, limit=run_limit) if selected_thread else []
        run_steps, tool_calls = await self._get_run_activity(
            session,
            run_ids=[run.id for run in runs],
        ) if runs else ([], [])
        return {
            "workspace": workspace,
            "selected_thread": selected_thread,
            "selected_project": selected_project,
            "task_memory": self._read_thread_shared_memory(selected_thread) if selected_thread else None,
            "project_memory": self._read_project_shared_memory(selected_project) if selected_project else None,
            "threads": thread_summaries,
            "messages": messages,
            "runs": runs,
            "run_steps": run_steps,
            "tool_calls": tool_calls,
        }

    async def get_task_rail(
        self,
        session: AsyncSession,
        *,
        workspace_id,
    ) -> dict[str, Any]:
        workspace, threads = await self.list_workspace_threads(session, workspace_id)
        projects = await self.list_workspace_projects(session, workspace_id)
        self._ensure_metadata_aliases(threads)
        self._ensure_metadata_aliases(projects)
        thread_summaries = await self._build_thread_summaries(session, threads)
        project_summaries = self._build_project_summaries(projects, thread_summaries)
        return {
            "workspace": workspace,
            "projects": project_summaries,
            "threads": thread_summaries,
        }

    async def get_task_templates(
        self,
        session: AsyncSession,
        *,
        workspace_id,
    ) -> dict[str, Any]:
        workspace_result = await session.execute(select(Workspace).where(Workspace.id == workspace_id))
        workspace = workspace_result.scalar_one()
        return {
            "workspace": workspace,
            "templates": list_task_templates(),
        }

    async def get_workbench_tree(
        self,
        session: AsyncSession,
        *,
        workspace_id,
        relative_path: str = ".",
    ) -> dict[str, Any]:
        workspace_result = await session.execute(select(Workspace).where(Workspace.id == workspace_id))
        workspace = workspace_result.scalar_one()
        normalized_relative_path = self._normalize_workbench_relative_path(relative_path)
        result = await self.filesystem.list_files(relative_path=normalized_relative_path, recursive=False)
        if result.get("status") != "completed":
            raise ValueError(str(result.get("error") or "Workbench tree lookup failed."))

        entries: list[dict[str, Any]] = []
        for entry in result.get("entries", []):
            if not isinstance(entry, dict):
                continue
            relative_entry_path = str(entry.get("relative_path") or "").strip()
            if not relative_entry_path:
                continue
            name = str(entry.get("name") or Path(relative_entry_path).name or relative_entry_path)
            kind = "dir" if entry.get("kind") == "dir" else "file"
            size_bytes = entry.get("size_bytes")
            entries.append(
                {
                    "name": name,
                    "relative_path": relative_entry_path,
                    "kind": kind,
                    "extension": str(entry.get("extension")) if entry.get("extension") else None,
                    "size_bytes": int(size_bytes) if isinstance(size_bytes, (int, float)) else None,
                }
            )

        entries.sort(key=lambda item: (item["kind"] != "dir", item["name"].lower()))
        current_path = self._normalize_workbench_relative_path(relative_path)
        parent_path = self._parent_workbench_path(current_path)
        return {
            "workspace": workspace,
            "root_label": self.filesystem.root.name,
            "relative_path": current_path,
            "parent_relative_path": parent_path,
            "entries": entries,
        }

    async def get_workbench_file(
        self,
        session: AsyncSession,
        *,
        workspace_id,
        relative_path: str,
        max_chars: int = 24000,
    ) -> dict[str, Any]:
        workspace_result = await session.execute(select(Workspace).where(Workspace.id == workspace_id))
        workspace = workspace_result.scalar_one()
        normalized_relative_path = self._normalize_workbench_relative_path(relative_path)
        path = self.resolve_workbench_path(normalized_relative_path)
        if not path.exists():
            raise ValueError("Workbench file not found.")
        if path.is_dir():
            raise ValueError("Cannot open a directory as a file.")

        result = await self.filesystem.read_text(relative_path=normalized_relative_path, max_chars=max_chars)
        if result.get("status") != "completed":
            raise ValueError(str(result.get("error") or "Workbench file read failed."))

        return {
            "workspace": workspace,
            "root_label": self.filesystem.root.name,
            "relative_path": str(result.get("relative_path") or normalized_relative_path),
            "name": str(result.get("name") or path.name),
            "extension": str(result.get("extension")) if result.get("extension") else (path.suffix.lower() or None),
            "size_bytes": int(result.get("size_bytes") or path.stat().st_size),
            "truncated": bool(result.get("truncated")),
            "content": str(result.get("content") or ""),
        }

    async def save_workbench_file(
        self,
        session: AsyncSession,
        *,
        workspace_id,
        relative_path: str,
        content: str,
        create_if_missing: bool = False,
        max_chars: int = 24000,
    ) -> dict[str, Any]:
        workspace_result = await session.execute(select(Workspace).where(Workspace.id == workspace_id))
        workspace = workspace_result.scalar_one()
        normalized_relative_path = self._normalize_workbench_relative_path(relative_path)
        if normalized_relative_path == ".":
            raise ValueError("Workbench save requires a target file path.")

        path = self._resolve_mutable_workbench_path(normalized_relative_path)
        if path.exists() and path.is_dir():
            raise ValueError("Cannot save a directory as a file.")
        if not path.exists() and not create_if_missing:
            raise ValueError("Workbench file not found.")

        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        saved_at = utc_now()

        return {
            "workspace": workspace,
            "relative_path": normalized_relative_path,
            "saved_at": saved_at,
            "file": self._build_workbench_file_payload(
                workspace=workspace,
                relative_path=normalized_relative_path,
                path=path,
                content=content,
                max_chars=max_chars,
            ),
        }

    async def get_workbench_repo_status(
        self,
        session: AsyncSession,
        *,
        workspace_id,
    ) -> dict[str, Any]:
        workspace_result = await session.execute(select(Workspace).where(Workspace.id == workspace_id))
        workspace = workspace_result.scalar_one()
        repo_payload = await self._build_workbench_repo_payload()
        return {
            "workspace": workspace,
            **repo_payload,
        }

    async def get_workbench_diff(
        self,
        session: AsyncSession,
        *,
        workspace_id,
        relative_path: str,
        max_chars: int = 40000,
    ) -> dict[str, Any]:
        workspace_result = await session.execute(select(Workspace).where(Workspace.id == workspace_id))
        workspace = workspace_result.scalar_one()
        normalized_relative_path = self._normalize_workbench_relative_path(relative_path)
        if normalized_relative_path == ".":
            raise ValueError("Workbench diff requires a target file path.")

        repo_payload = await self._build_workbench_repo_payload()
        file_status = next(
            (
                file_state
                for file_state in repo_payload["changed_files"]
                if file_state["relative_path"] == normalized_relative_path
            ),
            None,
        )

        if not repo_payload["is_repo"]:
            return {
                "workspace": workspace,
                "relative_path": normalized_relative_path,
                "compare_target": "HEAD",
                "has_changes": False,
                "status": None,
                "diff": "",
                "truncated": False,
                "note": "Git repository metadata is unavailable for this workspace.",
            }

        git_result = await self._run_git_command("diff", "--no-ext-diff", "HEAD", "--", normalized_relative_path)
        if git_result is None:
            return {
                "workspace": workspace,
                "relative_path": normalized_relative_path,
                "compare_target": "HEAD",
                "has_changes": False,
                "status": file_status["status"] if file_status else None,
                "diff": "",
                "truncated": False,
                "note": "Git is not installed or is unavailable in the runtime environment.",
            }

        returncode, stdout, stderr = git_result
        if returncode != 0:
            raise ValueError(stderr or "Workbench diff failed.")

        diff_text = stdout.strip("\n")
        truncated = len(diff_text) > max_chars
        note: str | None = None
        if not diff_text:
            if file_status and file_status.get("is_untracked"):
                note = "This file is untracked, so there is no Git diff against HEAD yet."
            else:
                note = "No saved repository changes were detected for this file."

        return {
            "workspace": workspace,
            "relative_path": normalized_relative_path,
            "compare_target": "HEAD",
            "has_changes": bool(diff_text),
            "status": file_status["status"] if file_status else None,
            "diff": diff_text[:max_chars],
            "truncated": truncated,
            "note": note,
        }

    async def sync_thread_checklist_to_markdown(
        self,
        session: AsyncSession,
        *,
        workspace_id,
        thread_id,
        relative_path: str = "todo.md",
        heading: str | None = None,
        max_chars: int = 24000,
    ) -> dict[str, Any]:
        workspace_result = await session.execute(select(Workspace).where(Workspace.id == workspace_id))
        workspace = workspace_result.scalar_one()

        thread_result = await session.execute(select(ChatThread).where(ChatThread.id == thread_id))
        thread = thread_result.scalar_one_or_none()
        if thread is None:
            raise ValueError("Thread not found.")
        if thread.workspace_id != workspace.id:
            raise ValueError("Thread does not belong to the requested workspace.")

        run_result = await session.execute(
            select(Run)
            .where(Run.thread_id == thread.id)
            .order_by(desc(Run.created_at))
            .limit(1)
        )
        latest_run = run_result.scalar_one_or_none()
        if latest_run is None:
            raise ValueError("This thread has no persisted run plan to sync yet.")

        step_result = await session.execute(
            select(RunStep)
            .where(RunStep.run_id == latest_run.id)
            .order_by(RunStep.step_index, RunStep.created_at)
        )
        checklist_items = self._build_task_checklist(
            run=latest_run,
            run_steps=list(step_result.scalars().all()),
        )
        if not checklist_items:
            raise ValueError("The latest run does not contain a checklist-ready plan yet.")

        normalized_relative_path = self._normalize_workbench_relative_path(relative_path)
        if normalized_relative_path == ".":
            raise ValueError("Todo sync requires a target file path.")

        path = self.resolve_workbench_path(normalized_relative_path)
        if path.exists() and path.is_dir():
            raise ValueError("Todo sync target must be a file, not a directory.")
        if path.suffix.lower() not in {".md", ".mdx", ".txt"}:
            raise ValueError("Todo sync currently supports Markdown and plain text files only.")

        existed = path.exists()
        existing_content = path.read_text(encoding="utf-8") if existed else ""
        synced_at = utc_now()
        next_content = self._merge_task_checklist_content(
            existing_content=existing_content,
            block=self._render_task_checklist_block(
                thread_title=thread.title,
                checklist_items=checklist_items,
                heading=heading,
                synced_at=synced_at,
            ),
        )

        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(next_content, encoding="utf-8")

        completed_items = sum(1 for item in checklist_items if item["completed"])
        return {
            "workspace": workspace,
            "thread": thread,
            "relative_path": normalized_relative_path,
            "created": not existed,
            "total_items": len(checklist_items),
            "completed_items": completed_items,
            "file": self._build_workbench_file_payload(
                workspace=workspace,
                relative_path=normalized_relative_path,
                path=path,
                content=next_content,
                max_chars=max_chars,
            ),
        }

    async def get_agents_surface(
        self,
        session: AsyncSession,
        *,
        workspace_id,
        limit: int = 48,
    ) -> dict[str, Any]:
        workspace_result = await session.execute(select(Workspace).where(Workspace.id == workspace_id))
        workspace = workspace_result.scalar_one()
        now = utc_now()
        activity_window_hours = 24
        active_cutoff = now - timedelta(hours=activity_window_hours)
        live_cutoff = now - timedelta(minutes=15)
        agent_key_by_name = {
            definition.name: key for key, definition in AGENT_CATALOG.items()
        }
        step_rows = await session.execute(
            select(RunStep, Run, ChatThread)
            .join(Run, Run.id == RunStep.run_id)
            .join(ChatThread, ChatThread.id == Run.thread_id)
            .where(Run.workspace_id == workspace.id)
            .order_by(desc(RunStep.created_at))
            .limit(limit)
        )
        rows = step_rows.all()
        step_ids = [step.id for step, _run, _thread in rows]
        tool_rows_result = None
        if step_ids:
            tool_rows_result = await session.execute(
                select(ToolCall)
                .where(ToolCall.run_step_id.in_(step_ids))
                .order_by(desc(ToolCall.created_at))
            )
        tool_rows = tool_rows_result.all() if tool_rows_result is not None else []
        tool_calls_by_step: dict[Any, list[ToolCall]] = defaultdict(list)
        for item in tool_rows:
            tool_call = item[0] if isinstance(item, tuple) else item
            tool_calls_by_step[tool_call.run_step_id].append(tool_call)

        step_activity: dict[str, dict[str, Any]] = defaultdict(
            lambda: {
                "step_count": 0,
                "recent_step_count": 0,
                "confidence_sum": 0.0,
                "escalation_count": 0,
                "tool_call_count": 0,
                "active_threads": set(),
                "active_projects": set(),
                "last_active_at": None,
                "last_status": None,
                "last_model": None,
                "last_provider": None,
                "status_breakdown": defaultdict(int),
                "recent_summaries": [],
                "recent_tools": [],
                "recent_steps": [],
            }
        )
        recent_activity: list[dict[str, Any]] = []

        for step, run, thread in rows:
            agent_key = agent_key_by_name.get(step.agent_name)
            if agent_key is None:
                continue
            output_payload = step.output_payload if isinstance(step.output_payload, dict) else {}
            validation = output_payload.get("validation")
            validation_summary = validation.get("summary") if isinstance(validation, dict) else ""
            summary = self._compact_summary(
                str(
                    output_payload.get("content")
                    or output_payload.get("summary")
                    or validation_summary
                    or ""
                )
            )
            model = output_payload.get("model")
            provider = output_payload.get("provider")
            step_tool_calls = tool_calls_by_step.get(step.id, [])
            tool_names = list(
                dict.fromkeys(
                    tool_call.tool_name
                    for tool_call in step_tool_calls
                    if isinstance(tool_call.tool_name, str) and tool_call.tool_name.strip()
                )
            )
            escalated = bool(
                output_payload.get("escalated_from_fast")
                or (validation.get("escalated_from_fast") if isinstance(validation, dict) else False)
            )
            step_snapshot = {
                "run_step_id": step.id,
                "run_id": run.id,
                "thread_id": thread.id,
                "thread_title": thread.title,
                "project_id": thread.project_id,
                "status": step.status,
                "confidence": round(float(step.confidence or 0.0), 4),
                "summary": summary or None,
                "validation_summary": validation_summary or None,
                "model": str(model) if isinstance(model, str) and model.strip() else None,
                "provider": str(provider) if isinstance(provider, str) and provider.strip() else None,
                "tools": tool_names[:6],
                "created_at": step.created_at,
            }
            recent_activity.append(
                {
                    **step_snapshot,
                    "agent_key": agent_key,
                    "agent_name": step.agent_name,
                }
            )
            bucket = step_activity[step.agent_name]
            bucket["step_count"] += 1
            bucket["confidence_sum"] += float(step.confidence or 0.0)
            if step.created_at >= active_cutoff:
                bucket["recent_step_count"] += 1
            if escalated:
                bucket["escalation_count"] += 1
            bucket["tool_call_count"] += len(step_tool_calls)
            bucket["active_threads"].add(str(thread.id))
            if thread.project_id is not None:
                bucket["active_projects"].add(str(thread.project_id))
            bucket["status_breakdown"][step.status] += 1
            if bucket["last_active_at"] is None or step.created_at > bucket["last_active_at"]:
                bucket["last_active_at"] = step.created_at
                bucket["last_status"] = step.status
                bucket["last_model"] = step_snapshot["model"]
                bucket["last_provider"] = step_snapshot["provider"]
            if summary:
                bucket["recent_summaries"].append(summary)
            for tool_name in tool_names:
                if tool_name not in bucket["recent_tools"]:
                    bucket["recent_tools"].append(tool_name)
            bucket["recent_steps"].append(step_snapshot)

        total_steps = 0
        total_confidence = 0.0
        total_tool_calls = 0
        total_escalations = 0
        active_agents_24h = 0
        busy_agents = 0
        idle_agents = 0
        latest_activity: datetime | None = None

        agents: list[dict[str, Any]] = []
        for key, definition in AGENT_CATALOG.items():
            activity = step_activity.get(definition.name, {})
            step_count = int(activity.get("step_count", 0))
            confidence_sum = float(activity.get("confidence_sum", 0.0))
            recent_step_count = int(activity.get("recent_step_count", 0))
            escalation_count = int(activity.get("escalation_count", 0))
            tool_call_count = int(activity.get("tool_call_count", 0))
            last_active_at = activity.get("last_active_at")
            if isinstance(last_active_at, datetime):
                if latest_activity is None or last_active_at > latest_activity:
                    latest_activity = last_active_at
            if last_active_at and last_active_at >= live_cutoff:
                health_state = "live"
            elif last_active_at and last_active_at >= active_cutoff:
                health_state = "active"
            elif step_count > 0:
                health_state = "idle"
            else:
                health_state = "quiet"
            workload_score = min(
                100,
                recent_step_count * 24
                + len(activity.get("active_threads", set())) * 10
                + escalation_count * 8
                + min(tool_call_count, 10) * 3,
            )
            if health_state in {"live", "active"}:
                active_agents_24h += 1
            else:
                idle_agents += 1
            if workload_score >= 40 or recent_step_count >= 2:
                busy_agents += 1
            total_steps += step_count
            total_confidence += confidence_sum
            total_tool_calls += tool_call_count
            total_escalations += escalation_count
            agents.append(
                {
                    "key": key,
                    "name": definition.name,
                    "fast_model": definition.fast_model,
                    "slow_model": definition.slow_model,
                    "specialties": list(definition.specialties),
                    "tools": [
                        {
                            "name": tool["name"],
                            "description": tool["description"],
                        }
                        for tool in self.tools_registry.list_for_agent(key)
                    ],
                    "health_state": health_state,
                    "workload_score": workload_score,
                    "step_count": step_count,
                    "recent_step_count": recent_step_count,
                    "average_confidence": round(confidence_sum / step_count, 4) if step_count else 0.0,
                    "escalation_count": escalation_count,
                    "tool_call_count": tool_call_count,
                    "active_thread_count": len(activity.get("active_threads", set())),
                    "active_project_count": len(activity.get("active_projects", set())),
                    "last_active_at": last_active_at,
                    "last_status": activity.get("last_status"),
                    "last_model": activity.get("last_model"),
                    "last_provider": activity.get("last_provider"),
                    "recent_tools": list(activity.get("recent_tools", []))[:6],
                    "status_breakdown": dict(activity.get("status_breakdown", {})),
                    "recent_summaries": list(dict.fromkeys(activity.get("recent_summaries", [])))[:3],
                    "recent_steps": list(activity.get("recent_steps", []))[:4],
                }
            )

        agents.sort(
            key=lambda agent: (
                agent["workload_score"],
                agent["last_active_at"] or datetime.min.replace(tzinfo=utc_now().tzinfo),
                agent["name"].lower(),
            ),
            reverse=True,
        )
        recent_activity.sort(key=lambda item: item["created_at"], reverse=True)
        return {
            "workspace": workspace,
            "supervisor_model": settings.supervisor_model,
            "overview": {
                "total_agents": len(AGENT_CATALOG),
                "active_agents_24h": active_agents_24h,
                "busy_agents": min(busy_agents, len(AGENT_CATALOG)),
                "idle_agents": idle_agents,
                "total_steps": total_steps,
                "total_tool_calls": total_tool_calls,
                "escalation_count": total_escalations,
                "average_confidence": round(total_confidence / total_steps, 4) if total_steps else 0.0,
                "activity_window_hours": activity_window_hours,
                "last_activity_at": latest_activity,
            },
            "agents": agents,
            "recent_activity": recent_activity[:14],
        }

    async def search_workspace(
        self,
        session: AsyncSession,
        *,
        workspace_id,
        query: str,
        project_id=None,
        limit: int = 24,
    ) -> dict[str, Any]:
        workspace_result = await session.execute(select(Workspace).where(Workspace.id == workspace_id))
        workspace = workspace_result.scalar_one()
        scoped_project = None
        if project_id is not None:
            project_result = await session.execute(select(Project).where(Project.id == project_id))
            scoped_project = project_result.scalar_one_or_none()
            if scoped_project is None:
                raise ValueError("Project not found.")
            if scoped_project.workspace_id != workspace.id:
                raise ValueError("Project does not belong to the requested workspace.")

        scope = "project" if scoped_project is not None else "workspace"
        normalized_query = " ".join(query.split()).strip()
        searched_fields = [
            "project_name",
            "project_description",
            "thread_title",
            "message_content",
            "run_request",
            "run_summary",
            "final_response",
            "document_title",
            "document_source_uri",
            "document_content",
            "document_tags",
            "artifact_title",
            "artifact_kind",
            "artifact_storage_key",
        ]
        if not normalized_query:
            return {
                "workspace": workspace,
                "query": "",
                "scope": scope,
                "project_id": scoped_project.id if scoped_project else None,
                "total_results": 0,
                "result_counts": {},
                "searched_fields": searched_fields,
                "results": [],
            }

        pattern = f"%{normalized_query}%"
        lowered_query = normalized_query.lower()
        hit_map: dict[Any, dict[str, Any]] = defaultdict(
            lambda: {
                "score": 0.0,
                "matched_by": set(),
                "highlight": None,
                "highlight_score": 0.0,
            }
        )

        project_rows = await session.execute(
            select(Project)
            .where(
                Project.workspace_id == workspace.id,
                or_(
                    Project.name.ilike(pattern),
                    Project.description.ilike(pattern),
                ),
            )
            .order_by(desc(Project.updated_at), desc(Project.created_at))
            .limit(limit * 4)
        )
        for project in project_rows.scalars().all():
            if scoped_project is not None and project.id != scoped_project.id:
                continue
            if project.name and lowered_query in project.name.lower():
                score = 7.6
                if project.name.lower() == lowered_query:
                    score += 4.0
                elif project.name.lower().startswith(lowered_query):
                    score += 2.0
                self._register_generic_search_hit(
                    hit_map,
                    result_key=("project", project.id),
                    source="project_name",
                    text=project.name,
                    score=score,
                    query=normalized_query,
                )
            if project.description and lowered_query in project.description.lower():
                self._register_generic_search_hit(
                    hit_map,
                    result_key=("project", project.id),
                    source="project_description",
                    text=project.description,
                    score=3.5,
                    query=normalized_query,
                )

        title_rows = await session.execute(
            select(ChatThread.id, ChatThread.title)
            .where(
                ChatThread.workspace_id == workspace.id,
                ChatThread.project_id == scoped_project.id if scoped_project is not None else True,
                ChatThread.title.ilike(pattern),
            )
            .order_by(desc(ChatThread.updated_at), desc(ChatThread.created_at))
            .limit(limit * 4)
        )
        for thread_id, title in title_rows.all():
            score = 8.0
            lowered_title = (title or "").lower()
            if lowered_title == lowered_query:
                score += 4.0
            elif lowered_title.startswith(lowered_query):
                score += 2.0
            self._register_search_hit(
                hit_map,
                thread_id=thread_id,
                source="thread_title",
                text=title,
                score=score,
                query=normalized_query,
            )

        message_rows = await session.execute(
            select(Message.thread_id, Message.content)
            .join(ChatThread, ChatThread.id == Message.thread_id)
            .where(
                ChatThread.workspace_id == workspace.id,
                ChatThread.project_id == scoped_project.id if scoped_project is not None else True,
                Message.content.ilike(pattern),
            )
            .order_by(desc(Message.created_at))
            .limit(limit * 12)
        )
        for thread_id, content in message_rows.all():
            self._register_search_hit(
                hit_map,
                thread_id=thread_id,
                source="message_content",
                text=content,
                score=4.5,
                query=normalized_query,
            )

        run_rows = await session.execute(
            select(Run.thread_id, Run.user_message, Run.summary, Run.final_response)
            .join(ChatThread, ChatThread.id == Run.thread_id)
            .where(
                ChatThread.workspace_id == workspace.id,
                ChatThread.project_id == scoped_project.id if scoped_project is not None else True,
                or_(
                    Run.user_message.ilike(pattern),
                    Run.summary.ilike(pattern),
                    Run.final_response.ilike(pattern),
                ),
            )
            .order_by(desc(Run.created_at))
            .limit(limit * 12)
        )
        for thread_id, user_message, summary, final_response in run_rows.all():
            if user_message and lowered_query in user_message.lower():
                self._register_search_hit(
                    hit_map,
                    thread_id=thread_id,
                    source="run_request",
                    text=user_message,
                    score=3.8,
                    query=normalized_query,
                )
            if summary and lowered_query in summary.lower():
                self._register_search_hit(
                    hit_map,
                    thread_id=thread_id,
                    source="run_summary",
                    text=summary,
                    score=3.4,
                    query=normalized_query,
                )
            if final_response and lowered_query in final_response.lower():
                self._register_search_hit(
                    hit_map,
                    thread_id=thread_id,
                    source="final_response",
                    text=final_response,
                    score=3.2,
                    query=normalized_query,
                )

        document_rows = await session.execute(
            select(Document)
            .where(
                Document.workspace_id == workspace.id,
                or_(
                    Document.title.ilike(pattern),
                    Document.source_uri.ilike(pattern),
                    Document.content_text.ilike(pattern),
                ),
            )
            .order_by(desc(Document.created_at))
            .limit(limit * 8)
        )
        for document in document_rows.scalars().all():
            if scoped_project is not None and not self._metadata_matches_project(
                document.metadata_,
                scoped_project.id,
            ):
                continue
            if document.title and lowered_query in document.title.lower():
                score = 7.0
                if document.title.lower() == lowered_query:
                    score += 3.5
                elif document.title.lower().startswith(lowered_query):
                    score += 1.8
                self._register_generic_search_hit(
                    hit_map,
                    result_key=("document", document.id),
                    source="document_title",
                    text=document.title,
                    score=score,
                    query=normalized_query,
                )
            if document.source_uri and lowered_query in document.source_uri.lower():
                self._register_generic_search_hit(
                    hit_map,
                    result_key=("document", document.id),
                    source="document_source_uri",
                    text=document.source_uri,
                    score=3.8,
                    query=normalized_query,
                )
            if document.content_text and lowered_query in document.content_text.lower():
                self._register_generic_search_hit(
                    hit_map,
                    result_key=("document", document.id),
                    source="document_content",
                    text=document.content_text,
                    score=2.9,
                    query=normalized_query,
                )
            for tag in self._document_search_tags(document.metadata_):
                if lowered_query in tag.lower():
                    self._register_generic_search_hit(
                        hit_map,
                        result_key=("document", document.id),
                        source="document_tags",
                        text=tag,
                        score=2.6,
                        query=normalized_query,
                    )

        artifact_rows = await session.execute(
            select(Artifact, ChatThread.project_id)
            .outerjoin(Run, Run.id == Artifact.run_id)
            .outerjoin(ChatThread, ChatThread.id == Run.thread_id)
            .where(
                Artifact.workspace_id == workspace.id,
                or_(
                    Artifact.title.ilike(pattern),
                    Artifact.kind.ilike(pattern),
                    Artifact.storage_key.ilike(pattern),
                ),
            )
            .order_by(desc(Artifact.created_at))
            .limit(limit * 8)
        )
        for artifact, artifact_project_id in artifact_rows.all():
            if scoped_project is not None and not (
                artifact_project_id == scoped_project.id
                or self._metadata_matches_project(artifact.metadata_, scoped_project.id)
            ):
                continue
            if artifact.title and lowered_query in artifact.title.lower():
                score = 6.4
                if artifact.title.lower() == lowered_query:
                    score += 3.0
                elif artifact.title.lower().startswith(lowered_query):
                    score += 1.4
                self._register_generic_search_hit(
                    hit_map,
                    result_key=("artifact", artifact.id),
                    source="artifact_title",
                    text=artifact.title,
                    score=score,
                    query=normalized_query,
                )
            if artifact.kind and lowered_query in artifact.kind.lower():
                self._register_generic_search_hit(
                    hit_map,
                    result_key=("artifact", artifact.id),
                    source="artifact_kind",
                    text=artifact.kind,
                    score=3.1,
                    query=normalized_query,
                )
            if artifact.storage_key and lowered_query in artifact.storage_key.lower():
                self._register_generic_search_hit(
                    hit_map,
                    result_key=("artifact", artifact.id),
                    source="artifact_storage_key",
                    text=artifact.storage_key,
                    score=2.4,
                    query=normalized_query,
                )

        matched_keys = list(hit_map.keys())
        if not matched_keys:
            return {
                "workspace": workspace,
                "query": normalized_query,
                "scope": scope,
                "project_id": scoped_project.id if scoped_project else None,
                "total_results": 0,
                "result_counts": {},
                "searched_fields": searched_fields,
                "results": [],
            }

        project_ids = [result_id for kind, result_id in matched_keys if kind == "project"]
        thread_ids = [result_id for kind, result_id in matched_keys if kind == "thread"]
        document_ids = [result_id for kind, result_id in matched_keys if kind == "document"]
        artifact_ids = [result_id for kind, result_id in matched_keys if kind == "artifact"]

        projects_by_id: dict[Any, Project] = {}
        if project_ids:
            projects_result = await session.execute(
                select(Project).where(Project.id.in_(project_ids))
            )
            projects_by_id = {project.id: project for project in projects_result.scalars().all()}

        summary_by_id: dict[Any, dict[str, Any]] = {}
        if thread_ids:
            threads_result = await session.execute(
                select(ChatThread)
                .where(ChatThread.id.in_(thread_ids))
                .order_by(desc(ChatThread.updated_at), desc(ChatThread.created_at))
            )
            threads = list(threads_result.scalars().all())
            summaries = await self._build_thread_summaries(session, threads)
            summary_by_id = {summary["id"]: summary for summary in summaries}

        documents_by_id: dict[Any, Document] = {}
        if document_ids:
            documents_result = await session.execute(
                select(Document).where(Document.id.in_(document_ids))
            )
            documents_by_id = {document.id: document for document in documents_result.scalars().all()}

        artifacts_by_id: dict[Any, Artifact] = {}
        if artifact_ids:
            artifacts_result = await session.execute(
                select(Artifact).where(Artifact.id.in_(artifact_ids))
            )
            artifacts_by_id = {artifact.id: artifact for artifact in artifacts_result.scalars().all()}

        ordered_keys = sorted(
            [
                result_key
                for result_key in matched_keys
                if (
                    (result_key[0] == "project" and result_key[1] in projects_by_id)
                    or (result_key[0] == "thread" and result_key[1] in summary_by_id)
                    or (result_key[0] == "document" and result_key[1] in documents_by_id)
                    or (result_key[0] == "artifact" and result_key[1] in artifacts_by_id)
                )
            ],
            key=lambda result_key: (
                hit_map[result_key]["score"],
                self._search_result_sort_key(
                    result_key=result_key,
                    projects_by_id=projects_by_id,
                    threads_by_id=summary_by_id,
                    documents_by_id=documents_by_id,
                    artifacts_by_id=artifacts_by_id,
                ),
            ),
            reverse=True,
        )

        results: list[dict[str, Any]] = []
        for result_key in ordered_keys[:limit]:
            kind, result_id = result_key
            result_payload: dict[str, Any] = {
                "kind": "task" if kind == "thread" else kind,
                "score": round(hit_map[result_key]["score"], 3),
                "matched_by": sorted(hit_map[result_key]["matched_by"]),
                "highlight": hit_map[result_key]["highlight"],
                "project": None,
                "thread": None,
                "document": None,
                "artifact": None,
            }
            if kind == "project":
                project = projects_by_id[result_id]
                result_payload["project"] = {
                    "id": project.id,
                    "workspace_id": project.workspace_id,
                    "name": project.name,
                    "description": project.description,
                    "status": project.status,
                    "metadata": project.metadata_ if isinstance(project.metadata_, dict) else {},
                    "created_at": project.created_at,
                    "updated_at": project.updated_at,
                }
            elif kind == "thread":
                result_payload["thread"] = summary_by_id[result_id]
            elif kind == "document":
                document = documents_by_id[result_id]
                result_payload["document"] = {
                    "id": document.id,
                    "workspace_id": document.workspace_id,
                    "title": document.title,
                    "source_type": document.source_type,
                    "source_uri": document.source_uri,
                    "mime_type": document.mime_type,
                    "status": document.status,
                    "metadata": document.metadata_ if isinstance(document.metadata_, dict) else {},
                    "created_at": document.created_at,
                }
            elif kind == "artifact":
                artifact = artifacts_by_id[result_id]
                result_payload["artifact"] = {
                    "id": artifact.id,
                    "run_id": artifact.run_id,
                    "document_id": artifact.document_id,
                    "workspace_id": artifact.workspace_id,
                    "kind": artifact.kind,
                    "title": artifact.title,
                    "storage_key": artifact.storage_key,
                    "metadata": artifact.metadata_ if isinstance(artifact.metadata_, dict) else {},
                    "created_at": artifact.created_at,
                }
            results.append(result_payload)

        result_counts = self._count_search_keys(ordered_keys)

        return {
            "workspace": workspace,
            "query": normalized_query,
            "scope": scope,
            "project_id": scoped_project.id if scoped_project else None,
            "total_results": len(ordered_keys),
            "result_counts": result_counts,
            "searched_fields": searched_fields,
            "results": results,
        }

    async def search_tasks(
        self,
        session: AsyncSession,
        *,
        workspace_id,
        query: str,
        limit: int = 24,
    ) -> dict[str, Any]:
        return await self.search_workspace(
            session,
            workspace_id=workspace_id,
            query=query,
            limit=limit,
        )

    async def create_thread(
        self,
        session: AsyncSession,
        *,
        workspace_id,
        project_id=None,
        title: str | None = None,
        actor_id=None,
    ) -> ChatThread:
        if project_id is not None:
            project_result = await session.execute(select(Project).where(Project.id == project_id))
            project = project_result.scalar_one_or_none()
            if project is None:
                raise ValueError("Project not found.")
            if project.workspace_id != workspace_id:
                raise ValueError("Project does not belong to the requested workspace.")
        thread = ChatThread(
            workspace_id=workspace_id,
            project_id=project_id,
            title=(title or "New thread").strip()[:255] or "New thread",
            status="active",
            metadata={"shared_memory": self._empty_shared_memory()},
        )
        session.add(thread)
        session.add(
            AuditLog(
                actor_id=actor_id,
                workspace_id=workspace_id,
                action="thread.created",
                resource_type="thread",
                resource_id=str(thread.id),
                details={"title": thread.title, "project_id": str(project_id) if project_id else None},
            )
        )
        await session.commit()
        await session.refresh(thread)
        return thread

    async def update_thread(
        self,
        session: AsyncSession,
        *,
        thread_id,
        title: str | None = None,
        status: str | None = None,
        metadata_updates: dict[str, Any] | None = None,
        actor_id=None,
    ) -> ChatThread:
        result = await session.execute(select(ChatThread).where(ChatThread.id == thread_id))
        thread = result.scalar_one_or_none()
        if thread is None:
            raise ValueError("Thread not found.")

        if title is not None:
            normalized_title = title.strip()
            if not normalized_title:
                raise ValueError("Thread title cannot be empty.")
            thread.title = normalized_title[:255]

        if status is not None:
            normalized_status = status.strip().lower()
            if normalized_status not in {"active", "paused", "archived"}:
                raise ValueError("Thread status must be active, paused, or archived.")
            thread.status = normalized_status

        if metadata_updates:
            existing_metadata = thread.metadata_ if isinstance(thread.metadata_, dict) else {}
            thread.metadata_ = {
                **existing_metadata,
                **metadata_updates,
            }

        thread.updated_at = utc_now()
        session.add(
            AuditLog(
                actor_id=actor_id,
                workspace_id=thread.workspace_id,
                action="thread.updated",
                resource_type="thread",
                resource_id=str(thread.id),
                details={
                    "title": thread.title,
                    "status": thread.status,
                    "metadata_keys": sorted((metadata_updates or {}).keys()),
                },
            )
        )
        await session.commit()
        await session.refresh(thread)
        return thread

    async def fork_thread(
        self,
        session: AsyncSession,
        *,
        thread_id,
        actor_id=None,
    ) -> ChatThread:
        result = await session.execute(select(ChatThread).where(ChatThread.id == thread_id))
        source_thread = result.scalar_one_or_none()
        if source_thread is None:
            raise ValueError("Thread not found.")

        source_messages = await self.get_messages(session, source_thread.id)
        source_metadata = source_thread.metadata_ if isinstance(source_thread.metadata_, dict) else {}
        fork_metadata = {
            **source_metadata,
            "forked_from_thread_id": str(source_thread.id),
            "published": False,
        }
        forked_thread = ChatThread(
            workspace_id=source_thread.workspace_id,
            project_id=source_thread.project_id,
            title=f"Fork of {source_thread.title}"[:255],
            status="active",
            metadata=fork_metadata,
        )
        session.add(forked_thread)
        await session.flush()

        for message in source_messages:
            session.add(
                Message(
                    thread_id=forked_thread.id,
                    run_id=None,
                    role=message.role,
                    content=message.content,
                    citations=message.citations,
                    metadata=message.metadata_,
                )
            )

        session.add(
            AuditLog(
                actor_id=actor_id,
                workspace_id=source_thread.workspace_id,
                action="thread.forked",
                resource_type="thread",
                resource_id=str(forked_thread.id),
                details={"source_thread_id": str(source_thread.id)},
            )
        )
        await session.commit()
        await session.refresh(forked_thread)
        return forked_thread

    async def create_project(
        self,
        session: AsyncSession,
        *,
        workspace_id,
        name: str,
        description: str | None = None,
        connectors: list[str] | None = None,
        actor_id=None,
    ) -> Project:
        normalized_connectors: list[str] = []
        for connector in connectors or []:
            compact = str(connector or "").strip().lower()
            if compact and compact not in normalized_connectors:
                normalized_connectors.append(compact[:64])
        project = Project(
            workspace_id=workspace_id,
            name=name.strip()[:255] or "New project",
            description=(description or "").strip() or None,
            status="active",
            metadata={
                "shared_memory": self._empty_shared_memory(),
                "connectors": normalized_connectors,
            },
        )
        session.add(project)
        await session.flush()
        session.add(
            AuditLog(
                actor_id=actor_id,
                workspace_id=workspace_id,
                action="project.created",
                resource_type="project",
                resource_id=str(project.id),
                details={"name": project.name, "connectors": normalized_connectors},
            )
        )
        await session.commit()
        await session.refresh(project)
        return project

    async def create_run(
        self,
        session: AsyncSession,
        payload: ChatRunRequest,
        *,
        actor_id=None,
    ) -> tuple[ChatThread, Run, list[Message]]:
        thread = await self._resolve_thread(session, payload, actor_id=actor_id)
        project = await self._load_thread_project(session, thread)
        run = await self._start_run(session, payload=payload, thread=thread)
        update_runtime_request_context(
            user_id=str(actor_id) if actor_id else None,
            workspace_id=str(payload.workspace_id),
            run_id=str(run.id),
        )
        grounding_context = (
            await self._build_grounding_context(
                session,
                workspace_id=payload.workspace_id,
                query=payload.message,
            )
            if payload.use_retrieval
            else []
        )
        try:
            execute_kwargs = {
                "metadata": {
                    "workspace_id": str(payload.workspace_id),
                    "run_id": str(run.id),
                    "thread_id": str(thread.id),
                    "project_id": str(project.id) if project else None,
                    "actor_id": str(actor_id) if actor_id else None,
                },
                "memory_context": self._build_memory_context(thread=thread, project=project),
            }
            if grounding_context:
                execute_kwargs["grounding_context"] = grounding_context
            result = await self._call_async_with_supported_kwargs(
                self.orchestrator.execute,
                payload.message,
                **execute_kwargs,
            )
            finalize_kwargs = {
                "payload": payload,
                "thread": thread,
                "project": project,
                "run": run,
                "result": result,
                "actor_id": actor_id,
            }
            if grounding_context:
                finalize_kwargs["grounding_context"] = grounding_context
            finalized_thread, finalized_run, messages = await self._call_async_with_supported_kwargs(
                self._finalize_run,
                session,
                **finalize_kwargs,
            )
            return finalized_thread, finalized_run, messages
        except Exception as exc:
            await self._mark_run_failed(
                session,
                thread=thread,
                run=run,
                actor_id=actor_id,
                error=str(exc),
            )
            raise

    async def stream_run(
        self,
        session: AsyncSession,
        payload: ChatRunRequest,
        *,
        actor_id=None,
    ) -> AsyncIterator[dict[str, object]]:
        thread = await self._resolve_thread(session, payload, actor_id=actor_id)
        project = await self._load_thread_project(session, thread)
        run = await self._start_run(session, payload=payload, thread=thread)
        queue: asyncio.Queue[dict[str, object]] = asyncio.Queue()
        update_runtime_request_context(
            user_id=str(actor_id) if actor_id else None,
            workspace_id=str(payload.workspace_id),
            run_id=str(run.id),
        )
        grounding_context = (
            await self._build_grounding_context(
                session,
                workspace_id=payload.workspace_id,
                query=payload.message,
            )
            if payload.use_retrieval
            else []
        )

        async def emit(event: str, data: dict) -> None:
            await queue.put({"event": event, "data": data})

        async def worker() -> None:
            try:
                await emit(
                    "thread",
                    {
                        "thread_id": str(thread.id),
                        "workspace_id": str(thread.workspace_id),
                        "project_id": str(getattr(thread, "project_id")) if getattr(thread, "project_id", None) else None,
                        "title": getattr(thread, "title", "Task"),
                        "task_memory": self._read_thread_shared_memory(thread),
                        "project_memory": self._read_project_shared_memory(project) if project else None,
                    },
                )
                await emit(
                    "run.created",
                    {
                        "run_id": str(run.id),
                        "thread_id": str(thread.id),
                        "workspace_id": str(run.workspace_id),
                        "supervisor_model": getattr(run, "supervisor_model", None),
                        "status": getattr(run, "status", "running"),
                        "created_at": run.created_at.isoformat(),
                        "user_message": getattr(run, "user_message", payload.message),
                    },
                )
                if grounding_context:
                    grounding_record = grounding_context[0]
                    await emit(
                        "grounding.loaded",
                        {
                            "query": payload.message,
                            "source_count": len(grounding_record.get("results", [])),
                            "sources": grounding_record.get("results", [])[:4],
                            "observability": grounding_record.get("observability", {}),
                        },
                    )
                execute_kwargs = {
                    "metadata": {
                        "workspace_id": str(payload.workspace_id),
                        "run_id": str(run.id),
                        "thread_id": str(thread.id),
                        "project_id": str(project.id) if project else None,
                        "actor_id": str(actor_id) if actor_id else None,
                        "composer_context": payload.composer_context if isinstance(payload.composer_context, dict) else {},
                    },
                    "memory_context": self._build_memory_context(thread=thread, project=project),
                    "event_handler": emit,
                }
                if grounding_context:
                    execute_kwargs["grounding_context"] = grounding_context
                result = await self._call_async_with_supported_kwargs(
                    self.orchestrator.execute,
                    payload.message,
                    **execute_kwargs,
                )
                finalize_kwargs = {
                    "payload": payload,
                    "result": result,
                    "thread": thread,
                    "project": project,
                    "run": run,
                    "actor_id": actor_id,
                }
                if grounding_context:
                    finalize_kwargs["grounding_context"] = grounding_context
                _, finalized_run, _ = await self._call_async_with_supported_kwargs(
                    self._finalize_run,
                    session,
                    **finalize_kwargs,
                )
                await emit(
                    "final",
                    {
                        "response": result["final_response"],
                        "summary": result["summary"],
                        "citations": result["citations"],
                        "execution_batches": result.get("execution_batches", []),
                        "scratchpad": result.get("scratchpad", {}),
                        "grounding": grounding_context[0] if grounding_context else None,
                        "task_memory": self._read_thread_shared_memory(thread),
                        "project_memory": self._read_project_shared_memory(project) if project else None,
                    },
                )
                await emit(
                    "run.persisted",
                    {
                        "run_id": str(finalized_run.id),
                        "thread_id": str(thread.id),
                        "status": finalized_run.status,
                    },
                )
            except Exception as exc:
                await self._mark_run_failed(
                    session,
                    thread=thread,
                    run=run,
                    actor_id=actor_id,
                    error=str(exc),
                )
                await emit(
                    "error",
                    {
                        "message": str(exc),
                        "type": exc.__class__.__name__,
                    },
                )
                await emit(
                    "run.persisted",
                    {
                        "run_id": str(run.id),
                        "thread_id": str(thread.id),
                        "status": "failed",
                    },
                )
            finally:
                await emit("done", {"status": "finished"})

        worker_task = asyncio.create_task(worker())
        try:
            while True:
                event = await queue.get()
                yield event
                if event["event"] == "done":
                    break
        finally:
            await worker_task

    async def _resolve_thread(
        self,
        session: AsyncSession,
        payload: ChatRunRequest,
        *,
        actor_id=None,
    ) -> ChatThread:
        if payload.thread_id:
            result = await session.execute(select(ChatThread).where(ChatThread.id == payload.thread_id))
            thread = result.scalar_one_or_none()
            if thread is None:
                raise ValueError("Thread not found.")
            if thread.workspace_id != payload.workspace_id:
                raise ValueError("Thread does not belong to the requested workspace.")
            return thread
        return await self.create_thread(
            session,
            workspace_id=payload.workspace_id,
            project_id=payload.project_id,
            title=self._thread_title_for_payload(payload),
            actor_id=actor_id,
        )

    def _thread_title_for_payload(self, payload: ChatRunRequest) -> str:
        template = get_task_template(payload.template_key)
        template_title = (
            template.get("chat_defaults", {}).get("thread_title")
            if isinstance(template, dict)
            else None
        )
        if isinstance(template_title, str) and template_title.strip():
            return template_title.strip()[:255]
        return payload.message[:70]

    async def _start_run(
        self,
        session: AsyncSession,
        *,
        payload: ChatRunRequest,
        thread: ChatThread,
    ) -> Run:
        thread.updated_at = utc_now()
        template = get_task_template(payload.template_key)
        template_title = (
            template.get("chat_defaults", {}).get("thread_title")
            if isinstance(template, dict)
            else None
        )
        if thread.title in {"General assistant", "New thread"}:
            thread.title = (
                template_title.strip()[:255]
                if isinstance(template_title, str) and template_title.strip()
                else payload.message[:70]
            )

        if payload.template_key:
            thread_metadata = thread.metadata_ if isinstance(thread.metadata_, dict) else {}
            thread.metadata_ = {
                **thread_metadata,
                "selected_template_key": payload.template_key,
                "selected_template_name": template.get("name") if isinstance(template, dict) else None,
                "selected_template_category": template.get("category") if isinstance(template, dict) else None,
            }

        run = Run(
            thread_id=thread.id,
            workspace_id=payload.workspace_id,
            status="running",
            supervisor_model=str(
                payload.model_profile
                or (
                    thread.metadata_.get("model_profile")
                    if isinstance(thread.metadata_, dict)
                    else None
                )
                or settings.supervisor_model
            ),
            user_message=payload.message,
        )
        session.add(run)
        await session.flush()

        session.add(
            Message(
                thread_id=thread.id,
                run_id=run.id,
                role="user",
                content=payload.message,
                metadata={
                    **(
                        {
                            "template_key": payload.template_key,
                        }
                        if payload.template_key
                        else {}
                    ),
                    **(
                        {
                            "composer_context": payload.composer_context,
                        }
                        if isinstance(payload.composer_context, dict) and payload.composer_context
                        else {}
                    ),
                },
            )
        )
        await session.commit()
        await session.refresh(thread)
        await session.refresh(run)
        return run

    async def _finalize_run(
        self,
        session: AsyncSession,
        *,
        payload: ChatRunRequest,
        result: dict[str, Any],
        thread: ChatThread,
        project: Project | None,
        run: Run,
        grounding_context: list[dict[str, Any]] | None = None,
        actor_id=None,
    ) -> tuple[ChatThread, Run, list[Message]]:
        thread.updated_at = utc_now()
        run.status = "completed"
        run.plan = result["plan"]
        run.final_response = result["final_response"]
        run.summary = result["summary"]
        task_memory = self._merge_shared_memory(
            existing=self._read_thread_shared_memory(thread),
            payload=payload,
            thread=thread,
            run=run,
            result=result,
        )
        project_memory = (
            self._merge_shared_memory(
                existing=self._read_project_shared_memory(project),
                payload=payload,
                thread=thread,
                run=run,
                result=result,
            )
            if project is not None
            else None
        )
        thread_metadata = thread.metadata_ if isinstance(thread.metadata_, dict) else {}
        thread.metadata_ = {
            **thread_metadata,
            "shared_memory": task_memory,
        }
        if project is not None:
            project.updated_at = thread.updated_at
            project_metadata = project.metadata_ if isinstance(project.metadata_, dict) else {}
            project.metadata_ = {
                **project_metadata,
                "shared_memory": project_memory,
            }
            session.add(project)

        session.add(
            Message(
                thread_id=thread.id,
                run_id=run.id,
                role="assistant",
                content=result["final_response"],
                citations=result["citations"],
                metadata={
                    "summary": result["summary"],
                    "execution_batches": result.get("execution_batches", []),
                    "scratchpad": result.get("scratchpad", {}),
                    "grounding": grounding_context[0] if grounding_context else None,
                    "task_memory": task_memory,
                    "project_memory": project_memory,
                    "template_key": payload.template_key,
                    "composer_context": (
                        payload.composer_context
                        if isinstance(payload.composer_context, dict) and payload.composer_context
                        else {}
                    ),
                },
            )
        )

        for step in result["steps"]:
            run_step = RunStep(
                run_id=run.id,
                agent_name=step["agent_name"],
                step_index=step["step_index"],
                status="completed",
                confidence=step["confidence"],
                input_payload={
                    "prompt": payload.message,
                    "composer_context": (
                        payload.composer_context
                        if isinstance(payload.composer_context, dict) and payload.composer_context
                        else {}
                    ),
                },
                output_payload={
                    "content": step["content"],
                    "model": step["model"],
                    "provider": step["provider"],
                    "fallback": step["fallback"],
                    "dependencies": step.get("dependencies", []),
                    "execution_mode": step.get("execution_mode"),
                    "batch_index": step.get("batch_index"),
                    "validation": step.get("validation", {}),
                    "expected_output": step.get("expected_output"),
                },
            )
            session.add(run_step)
            await session.flush()
            for tool in step.get("tools", []):
                session.add(
                    ToolCall(
                        run_step_id=run_step.id,
                        tool_name=tool.get("tool") or ("web_search" if tool.get("query") else "tool_context"),
                        status="completed",
                        input_payload={
                            "prompt": payload.message,
                            "composer_context": (
                                payload.composer_context
                                if isinstance(payload.composer_context, dict) and payload.composer_context
                                else {}
                            ),
                        },
                        output_payload=tool,
                    )
                )

        session.add(
            AuditLog(
                actor_id=actor_id,
                workspace_id=payload.workspace_id,
                action="run.completed",
                resource_type="run",
                resource_id=str(run.id),
                details={
                    "thread_id": str(thread.id),
                    "plan_length": len(result["plan"]),
                    "execution_batches": result.get("execution_batches", []),
                    "task_memory_run_count": task_memory.get("run_count", 0),
                    "project_memory_run_count": (
                        project_memory.get("run_count", 0) if isinstance(project_memory, dict) else None
                    ),
                },
            )
        )

        session.add(thread)
        await session.commit()
        await session.refresh(thread)
        if project is not None:
            await session.refresh(project)
        await session.refresh(run)
        messages = await self.get_messages(session, thread.id)
        return thread, run, messages

    async def _build_grounding_context(
        self,
        session: AsyncSession,
        *,
        workspace_id,
        query: str,
    ) -> list[dict[str, Any]]:
        try:
            bundle = await self.knowledge_service.search(
                session,
                workspace_id,
                query,
                filters=RetrievalFilters(limit=min(settings.retrieval_default_limit, 4)),
            )
        except Exception:
            return []

        if not bundle.results:
            return []

        results: list[dict[str, Any]] = []
        for item in bundle.results[:4]:
            results.append(
                {
                    "title": str(item.get("document_title") or "Knowledge source"),
                    "url": str(item.get("source_uri") or "").strip(),
                    "excerpt": self._compact_grounding_text(str(item.get("content") or ""), limit=260),
                    "document_id": str(item.get("document_id") or ""),
                    "chunk_id": str(item.get("chunk_id") or ""),
                    "source_type": str(item.get("source_type") or ""),
                    "source_uri": str(item.get("source_uri") or "").strip() or None,
                    "score": round(float(item.get("score") or 0.0), 4),
                    "chunk_index": int(item.get("chunk_index") or 0),
                    "token_estimate": int(item.get("token_estimate") or 0),
                }
            )

        return [
            {
                "tool": "knowledge_retrieval",
                "operation": "search",
                "status": "completed",
                "query": query,
                "results": results,
                "observability": bundle.observability.to_dict(),
                "summary": f"Retrieved {len(results)} grounded workspace source(s) for the current request.",
            }
        ]

    def _compact_grounding_text(self, value: str, limit: int = 220) -> str:
        compact = " ".join(value.split())
        return compact[:limit] + ("..." if len(compact) > limit else "")

    async def _mark_run_failed(
        self,
        session: AsyncSession,
        *,
        thread: ChatThread,
        run: Run,
        actor_id=None,
        error: str,
    ) -> None:
        thread.updated_at = utc_now()
        run.status = "failed"
        run.summary = error[:500]
        if hasattr(session, "add"):
            session.add(
                AuditLog(
                    actor_id=actor_id,
                    workspace_id=run.workspace_id,
                    action="run.failed",
                    resource_type="run",
                    resource_id=str(run.id),
                    details={"thread_id": str(thread.id), "error": error[:1000]},
                )
            )
        if hasattr(session, "commit"):
            await session.commit()

    async def _load_thread_project(
        self,
        session: AsyncSession,
        thread: ChatThread,
    ) -> Project | None:
        thread_project_id = getattr(thread, "project_id", None)
        if thread_project_id is None:
            return None
        result = await session.execute(select(Project).where(Project.id == thread_project_id))
        project = result.scalar_one_or_none()
        if project is None or project.workspace_id != thread.workspace_id:
            return None
        return project

    async def _call_async_with_supported_kwargs(
        self,
        func,
        /,
        *args,
        **kwargs,
    ):
        try:
            signature = inspect.signature(func)
        except (TypeError, ValueError):
            return await func(*args, **kwargs)

        accepts_var_kwargs = any(
            parameter.kind == inspect.Parameter.VAR_KEYWORD
            for parameter in signature.parameters.values()
        )
        if accepts_var_kwargs:
            return await func(*args, **kwargs)

        supported_kwargs = {
            key: value
            for key, value in kwargs.items()
            if key in signature.parameters
        }
        return await func(*args, **supported_kwargs)

    def _empty_shared_memory(self) -> dict[str, Any]:
        return {
            "summary": None,
            "findings": [],
            "risks": [],
            "open_questions": [],
            "recent_requests": [],
            "recent_summaries": [],
            "focus_areas": [],
            "agent_memory": [],
            "run_count": 0,
            "last_updated_at": None,
            "source_run_id": None,
            "source_thread_id": None,
        }

    def _read_thread_shared_memory(self, thread: ChatThread | None) -> dict[str, Any]:
        metadata = self._entity_metadata(thread)
        return self._normalize_shared_memory(metadata.get("shared_memory"))

    def _read_project_shared_memory(self, project: Project | None) -> dict[str, Any]:
        metadata = self._entity_metadata(project)
        return self._normalize_shared_memory(metadata.get("shared_memory"))

    def _entity_metadata(self, entity: Any | None) -> dict[str, Any]:
        if entity is None:
            return {}
        metadata = getattr(entity, "metadata_", None)
        if isinstance(metadata, dict):
            return metadata
        metadata = getattr(entity, "metadata", None)
        return metadata if isinstance(metadata, dict) else {}

    def _ensure_metadata_aliases(self, entities: list[Any]) -> None:
        for entity in entities:
            metadata = self._entity_metadata(entity)
            if metadata and not isinstance(getattr(entity, "metadata_", None), dict):
                try:
                    setattr(entity, "metadata_", metadata)
                except Exception:
                    pass

    def _build_memory_context(
        self,
        *,
        thread: ChatThread,
        project: Project | None,
    ) -> dict[str, Any]:
        return {
            "task_memory": self._read_thread_shared_memory(thread),
            "project_memory": self._read_project_shared_memory(project),
        }

    def _normalize_shared_memory(self, value: Any) -> dict[str, Any]:
        normalized = self._empty_shared_memory()
        raw = value if isinstance(value, dict) else {}
        summary = raw.get("summary")
        normalized["summary"] = (
            self._compact_summary(str(summary), limit=320) if isinstance(summary, str) and summary.strip() else None
        )
        for key in ("findings", "risks", "open_questions", "recent_requests", "recent_summaries", "focus_areas"):
            normalized[key] = self._memory_string_list(raw.get(key))
        normalized["agent_memory"] = self._normalize_agent_memory(raw.get("agent_memory"))
        try:
            normalized["run_count"] = max(int(raw.get("run_count") or 0), 0)
        except (TypeError, ValueError):
            normalized["run_count"] = 0
        for key in ("last_updated_at", "source_run_id", "source_thread_id"):
            current = raw.get(key)
            normalized[key] = str(current) if isinstance(current, str) and current.strip() else None
        return normalized

    def _memory_string_list(self, value: Any) -> list[str]:
        if isinstance(value, str):
            candidates = [value]
        elif isinstance(value, list):
            candidates = [str(item) for item in value if str(item).strip()]
        else:
            candidates = []

        seen: set[str] = set()
        normalized: list[str] = []
        for item in candidates:
            compact = self._compact_summary(item, limit=220)
            if not compact:
                continue
            key = compact.lower()
            if key in seen:
                continue
            seen.add(key)
            normalized.append(compact)
            if len(normalized) >= SHARED_MEMORY_LIST_LIMIT:
                break
        return normalized

    def _normalize_agent_memory(self, value: Any) -> list[dict[str, Any]]:
        if not isinstance(value, list):
            return []
        normalized: list[dict[str, Any]] = []
        seen: set[tuple[str, str]] = set()
        for item in value:
            if not isinstance(item, dict):
                continue
            agent = str(item.get("agent") or item.get("agent_name") or "").strip()
            summary = self._compact_summary(str(item.get("summary") or item.get("content") or ""), limit=220)
            if not agent or not summary:
                continue
            key = (agent.lower(), summary.lower())
            if key in seen:
                continue
            seen.add(key)
            normalized_item: dict[str, Any] = {"agent": agent, "summary": summary}
            confidence = item.get("confidence")
            try:
                if confidence is not None:
                    normalized_item["confidence"] = round(float(confidence), 4)
            except (TypeError, ValueError):
                pass
            normalized.append(normalized_item)
            if len(normalized) >= SHARED_MEMORY_AGENT_LIMIT:
                break
        return normalized

    def _merge_memory_strings(
        self,
        additions: list[str],
        existing: list[str],
    ) -> list[str]:
        return self._memory_string_list([*additions, *existing])

    def _merge_agent_memory(
        self,
        additions: list[dict[str, Any]],
        existing: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        return self._normalize_agent_memory([*additions, *existing])

    def _merge_shared_memory(
        self,
        *,
        existing: dict[str, Any],
        payload: ChatRunRequest,
        thread: ChatThread,
        run: Run,
        result: dict[str, Any],
    ) -> dict[str, Any]:
        current = self._normalize_shared_memory(existing)
        scratchpad = result.get("scratchpad") if isinstance(result.get("scratchpad"), dict) else {}
        scratchpad_findings = [
            str(item.get("summary") or "")
            for item in scratchpad.get("findings", [])
            if isinstance(item, dict) and str(item.get("summary") or "").strip()
        ]
        scratchpad_risks = [str(item) for item in scratchpad.get("risks", []) if str(item).strip()]
        scratchpad_questions = [
            str(item) for item in scratchpad.get("open_questions", []) if str(item).strip()
        ]
        focus_areas = [
            str(step.get("objective") or step.get("expected_output") or "")
            for step in result.get("plan", [])
            if isinstance(step, dict) and str(step.get("objective") or step.get("expected_output") or "").strip()
        ]
        agent_memory = [
            {
                "agent": str(step.get("agent_name") or step.get("agent_key") or "Agent"),
                "summary": self._compact_summary(str(step.get("content") or step.get("summary") or ""), limit=220),
                "confidence": step.get("confidence"),
            }
            for step in result.get("steps", [])
            if isinstance(step, dict) and str(step.get("content") or step.get("summary") or "").strip()
        ]
        latest_summary = self._compact_summary(
            str(result.get("summary") or result.get("final_response") or ""),
            limit=320,
        )

        return {
            "summary": latest_summary or current.get("summary"),
            "findings": self._merge_memory_strings(scratchpad_findings, current["findings"]),
            "risks": self._merge_memory_strings(scratchpad_risks, current["risks"]),
            "open_questions": self._merge_memory_strings(
                scratchpad_questions,
                current["open_questions"],
            ),
            "recent_requests": self._merge_memory_strings(
                [self._compact_summary(payload.message, limit=220)],
                current["recent_requests"],
            ),
            "recent_summaries": self._merge_memory_strings(
                [latest_summary] if latest_summary else [],
                current["recent_summaries"],
            ),
            "focus_areas": self._merge_memory_strings(focus_areas, current["focus_areas"]),
            "agent_memory": self._merge_agent_memory(agent_memory, current["agent_memory"]),
            "run_count": int(current.get("run_count", 0)) + 1,
            "last_updated_at": utc_now().isoformat(),
            "source_run_id": str(run.id),
            "source_thread_id": str(thread.id),
        }

    async def _build_thread_summaries(
        self,
        session: AsyncSession,
        threads: list[ChatThread],
    ) -> list[dict[str, Any]]:
        if not threads:
            return []

        thread_ids = [thread.id for thread in threads]
        message_count_rows = await session.execute(
            select(Message.thread_id, func.count(Message.id))
            .where(Message.thread_id.in_(thread_ids))
            .group_by(Message.thread_id)
        )
        run_count_rows = await session.execute(
            select(Run.thread_id, func.count(Run.id))
            .where(Run.thread_id.in_(thread_ids))
            .group_by(Run.thread_id)
        )
        latest_messages_rows = await session.execute(
            select(Message)
            .where(Message.thread_id.in_(thread_ids))
            .order_by(Message.thread_id, desc(Message.created_at))
        )

        message_counts = {thread_id: int(count) for thread_id, count in message_count_rows.all()}
        run_counts = {thread_id: int(count) for thread_id, count in run_count_rows.all()}
        latest_messages: dict[Any, Message] = {}
        for message in latest_messages_rows.scalars().all():
            latest_messages.setdefault(message.thread_id, message)

        summaries: list[dict[str, Any]] = []
        for thread in threads:
            latest_message = latest_messages.get(thread.id)
            summaries.append(
                {
                    "id": thread.id,
                    "workspace_id": thread.workspace_id,
                    "project_id": thread.project_id,
                    "title": thread.title,
                    "status": thread.status,
                    "metadata": thread.metadata_ if isinstance(thread.metadata_, dict) else {},
                    "created_at": thread.created_at,
                    "updated_at": thread.updated_at,
                    "message_count": message_counts.get(thread.id, 0),
                    "run_count": run_counts.get(thread.id, 0),
                    "last_message_preview": (
                        latest_message.content[:180] if latest_message is not None else None
                    ),
                    "last_activity_at": thread.updated_at,
                }
            )
        return summaries

    async def _get_run_activity(
        self,
        session: AsyncSession,
        *,
        run_ids: list[Any],
    ) -> tuple[list[RunStep], list[ToolCall]]:
        if not run_ids:
            return [], []

        run_step_rows = await session.execute(
            select(RunStep)
            .where(RunStep.run_id.in_(run_ids))
            .order_by(desc(RunStep.created_at), desc(RunStep.step_index))
        )
        run_steps = list(run_step_rows.scalars().all())
        if not run_steps:
            return [], []

        tool_call_rows = await session.execute(
            select(ToolCall)
            .where(ToolCall.run_step_id.in_([step.id for step in run_steps]))
            .order_by(desc(ToolCall.created_at))
        )
        tool_calls = list(tool_call_rows.scalars().all())
        return run_steps, tool_calls

    def _build_project_summaries(
        self,
        projects: list[Project],
        thread_summaries: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        thread_counts: dict[Any, int] = defaultdict(int)
        last_activity: dict[Any, datetime] = {}
        for thread in thread_summaries:
            project_id = thread.get("project_id")
            if project_id is None:
                continue
            thread_counts[project_id] += 1
            activity_at = thread.get("last_activity_at")
            if activity_at is not None and (
                project_id not in last_activity or activity_at > last_activity[project_id]
            ):
                last_activity[project_id] = activity_at

        summaries: list[dict[str, Any]] = []
        for project in projects:
            summaries.append(
                {
                    "id": project.id,
                    "workspace_id": project.workspace_id,
                    "name": project.name,
                    "description": project.description,
                    "status": project.status,
                    "metadata": (
                        getattr(project, "metadata", {})
                        if isinstance(getattr(project, "metadata", {}), dict)
                        else {}
                    ),
                    "created_at": project.created_at,
                    "updated_at": project.updated_at,
                    "thread_count": thread_counts.get(project.id, 0),
                    "last_activity_at": last_activity.get(project.id),
                }
            )

        summaries.sort(
            key=lambda item: (
                item["last_activity_at"] or item["updated_at"],
                item["name"].lower(),
            ),
            reverse=True,
        )
        return summaries

    def _build_task_checklist(
        self,
        *,
        run: Run,
        run_steps: list[RunStep],
    ) -> list[dict[str, Any]]:
        plan = run.plan if isinstance(run.plan, list) else []
        steps_by_index: dict[int, RunStep] = {}
        for step in sorted(run_steps, key=lambda current: (current.step_index, current.created_at)):
            steps_by_index[step.step_index] = step

        checklist_items: list[dict[str, Any]] = []
        if plan:
            for index, entry in enumerate(plan):
                payload = entry if isinstance(entry, dict) else {}
                step_index = int(payload.get("plan_index", index))
                step = steps_by_index.get(step_index)
                output_payload = step.output_payload if step and isinstance(step.output_payload, dict) else {}
                validation = (
                    output_payload.get("validation")
                    if isinstance(output_payload.get("validation"), dict)
                    else {}
                )
                title = str(
                    payload.get("objective")
                    or payload.get("expected_output")
                    or payload.get("key")
                    or f"Step {step_index + 1}"
                ).strip()
                status = str(step.status if step else ("completed" if run.status == "completed" else "queued"))
                summary = self._compact_summary(
                    str(
                        output_payload.get("content")
                        or output_payload.get("summary")
                        or validation.get("summary")
                        or payload.get("reason")
                        or payload.get("expected_output")
                        or ""
                    ),
                    limit=240,
                )
                checklist_items.append(
                    {
                        "step_index": step_index,
                        "key": str(payload.get("key") or f"step-{step_index + 1}"),
                        "title": title,
                        "status": status,
                        "completed": status == "completed",
                        "agent_name": step.agent_name if step else str(payload.get("key") or ""),
                        "summary": summary,
                        "execution_mode": str(
                            output_payload.get("execution_mode")
                            or payload.get("execution_mode")
                            or ""
                        ).strip()
                        or None,
                        "dependencies": [
                            str(value)
                            for value in (
                                payload.get("dependencies")
                                if isinstance(payload.get("dependencies"), list)
                                else output_payload.get("dependencies")
                                if isinstance(output_payload.get("dependencies"), list)
                                else []
                            )
                        ],
                    }
                )

        if checklist_items:
            return checklist_items

        for step in sorted(run_steps, key=lambda current: current.step_index):
            output_payload = step.output_payload if isinstance(step.output_payload, dict) else {}
            validation = (
                output_payload.get("validation")
                if isinstance(output_payload.get("validation"), dict)
                else {}
            )
            title = str(
                output_payload.get("expected_output")
                or output_payload.get("summary")
                or step.agent_name
                or f"Step {step.step_index + 1}"
            ).strip()
            checklist_items.append(
                {
                    "step_index": step.step_index,
                    "key": f"step-{step.step_index + 1}",
                    "title": title,
                    "status": step.status,
                    "completed": step.status == "completed",
                    "agent_name": step.agent_name,
                    "summary": self._compact_summary(
                        str(
                            output_payload.get("content")
                            or output_payload.get("summary")
                            or validation.get("summary")
                            or ""
                        ),
                        limit=240,
                    ),
                    "execution_mode": str(output_payload.get("execution_mode") or "").strip() or None,
                    "dependencies": [
                        str(value)
                        for value in (
                            output_payload.get("dependencies")
                            if isinstance(output_payload.get("dependencies"), list)
                            else []
                        )
                    ],
                }
            )

        return checklist_items

    def _render_task_checklist_block(
        self,
        *,
        thread_title: str,
        checklist_items: list[dict[str, Any]],
        heading: str | None,
        synced_at: datetime,
    ) -> str:
        total_items = len(checklist_items)
        completed_items = sum(1 for item in checklist_items if item["completed"])
        block_lines = [
            TASK_CHECKLIST_START_MARKER,
            f"## {heading.strip() if heading and heading.strip() else 'Swarm Task Checklist'}",
            "",
            f"Source task: {thread_title}",
            f"Last synced: {synced_at.isoformat()}",
            f"Progress: {completed_items}/{total_items} completed",
            "",
        ]

        for item in checklist_items:
            checkbox = "x" if item["completed"] else " "
            block_lines.append(f"- [{checkbox}] {item['title']}")
            meta_parts = [f"Status: {str(item['status']).replace('_', ' ')}"]
            if item.get("agent_name"):
                meta_parts.insert(0, f"Agent: {item['agent_name']}")
            if item.get("execution_mode"):
                meta_parts.append(f"Mode: {item['execution_mode']}")
            if item.get("dependencies"):
                meta_parts.append(f"Depends on: {', '.join(item['dependencies'])}")
            block_lines.append(f"  - {' | '.join(meta_parts)}")
            if item.get("summary"):
                block_lines.append(f"  - Note: {item['summary']}")
            block_lines.append("")

        while block_lines and not block_lines[-1]:
            block_lines.pop()
        block_lines.append(TASK_CHECKLIST_END_MARKER)
        return "\n".join(block_lines)

    def _merge_task_checklist_content(self, *, existing_content: str, block: str) -> str:
        start = existing_content.find(TASK_CHECKLIST_START_MARKER)
        if start != -1:
            end = existing_content.find(TASK_CHECKLIST_END_MARKER, start)
            if end != -1:
                before = existing_content[:start].rstrip()
                after = existing_content[end + len(TASK_CHECKLIST_END_MARKER) :].lstrip("\n")
                sections = [section for section in [before, block, after] if section]
                return "\n\n".join(sections).rstrip() + "\n"

        stripped = existing_content.rstrip()
        if stripped:
            return f"{stripped}\n\n{block}\n"
        return f"{block}\n"

    def _build_workbench_file_payload(
        self,
        *,
        workspace: Workspace,
        relative_path: str,
        path: Path,
        content: str,
        max_chars: int,
    ) -> dict[str, Any]:
        truncated = len(content) > max_chars
        return {
            "workspace_id": workspace.id,
            "root_label": self.filesystem.root.name,
            "relative_path": relative_path,
            "name": path.name,
            "extension": path.suffix.lower() or None,
            "size_bytes": path.stat().st_size,
            "truncated": truncated,
            "content": content[:max_chars],
        }

    def resolve_workbench_path(self, relative_path: str) -> Path:
        normalized_relative_path = self._normalize_workbench_relative_path(relative_path)
        return self.filesystem.resolve_read_path(normalized_relative_path)

    def _resolve_mutable_workbench_path(self, relative_path: str) -> Path:
        path = self.resolve_workbench_path(relative_path)
        relative_parts = Path(relative_path).parts
        if ".git" in relative_parts:
            raise ValueError("Workbench editing does not allow modifying Git internals.")
        return path

    async def _build_workbench_repo_payload(self) -> dict[str, Any]:
        root_label = self.filesystem.root.name
        if not (self.filesystem.root / ".git").exists():
            return {
                "is_repo": False,
                "root_label": root_label,
                "branch": None,
                "head": None,
                "dirty": False,
                "summary": "Git metadata unavailable",
                "changed_files": [],
                "staged_count": 0,
                "unstaged_count": 0,
                "untracked_count": 0,
            }
        git_probe = await self._run_git_command("rev-parse", "--is-inside-work-tree")
        if git_probe is None or git_probe[0] != 0 or git_probe[1].strip() != "true":
            return {
                "is_repo": False,
                "root_label": root_label,
                "branch": None,
                "head": None,
                "dirty": False,
                "summary": "Git metadata unavailable",
                "changed_files": [],
                "staged_count": 0,
                "unstaged_count": 0,
                "untracked_count": 0,
            }

        branch = await self._read_git_value("rev-parse", "--abbrev-ref", "HEAD")
        head = await self._read_git_value("rev-parse", "--short", "HEAD")
        status_result = await self._run_git_command("status", "--short", "--branch", "--untracked-files=all")
        if status_result is None or status_result[0] != 0:
            return {
                "is_repo": True,
                "root_label": root_label,
                "branch": branch,
                "head": head,
                "dirty": False,
                "summary": "Repository status unavailable",
                "changed_files": [],
                "staged_count": 0,
                "unstaged_count": 0,
                "untracked_count": 0,
            }

        lines = [line.rstrip() for line in status_result[1].splitlines()]
        summary = lines[0][2:].strip() if lines and lines[0].startswith("##") else None
        changed_files: list[dict[str, Any]] = []
        staged_count = 0
        unstaged_count = 0
        untracked_count = 0

        for line in lines[1:]:
            if len(line) < 3:
                continue
            staged_code = line[0]
            unstaged_code = line[1]
            display_path = line[3:].strip()
            if " -> " in display_path:
                display_path = display_path.split(" -> ", 1)[1]
            relative_path = display_path.replace("\\", "/")
            staged_status = self._git_status_label(staged_code)
            unstaged_status = self._git_status_label(unstaged_code)
            is_untracked = staged_code == "?" or unstaged_code == "?"

            if staged_status:
                staged_count += 1
            if unstaged_status:
                unstaged_count += 1
            if is_untracked:
                untracked_count += 1

            changed_files.append(
                {
                    "relative_path": relative_path,
                    "display_path": display_path,
                    "status": unstaged_status or staged_status or "clean",
                    "staged_status": staged_status,
                    "unstaged_status": unstaged_status,
                    "is_untracked": is_untracked,
                }
            )

        changed_files.sort(key=lambda item: item["relative_path"].lower())
        return {
            "is_repo": True,
            "root_label": root_label,
            "branch": branch,
            "head": head,
            "dirty": bool(changed_files),
            "summary": summary,
            "changed_files": changed_files,
            "staged_count": staged_count,
            "unstaged_count": unstaged_count,
            "untracked_count": untracked_count,
        }

    async def _read_git_value(self, *args: str) -> str | None:
        result = await self._run_git_command(*args)
        if result is None or result[0] != 0:
            return None
        value = result[1].strip()
        return value or None

    async def _run_git_command(self, *args: str) -> tuple[int, str, str] | None:
        def _runner() -> tuple[int, str, str]:
            completed = subprocess.run(
                ["git", *args],
                cwd=self.filesystem.root,
                capture_output=True,
                text=True,
                timeout=12,
                check=False,
            )
            return completed.returncode, completed.stdout, completed.stderr

        try:
            return await asyncio.to_thread(_runner)
        except (FileNotFoundError, subprocess.TimeoutExpired):
            return None

    def _git_status_label(self, code: str) -> str | None:
        mapping = {
            "M": "modified",
            "A": "added",
            "D": "deleted",
            "R": "renamed",
            "C": "copied",
            "U": "updated",
            "T": "type-changed",
            "?": "untracked",
        }
        return mapping.get(code)

    def _compact_summary(self, value: str | None, *, limit: int = 180) -> str:
        compact = " ".join((value or "").split()).strip()
        if not compact:
            return ""
        return compact if len(compact) <= limit else f"{compact[:limit]}..."

    def _register_generic_search_hit(
        self,
        hit_map: dict[Any, dict[str, Any]],
        *,
        result_key,
        source: str,
        text: str | None,
        score: float,
        query: str,
    ) -> None:
        if not text:
            return

        entry = hit_map.setdefault(
            result_key,
            {
                "score": 0.0,
                "matched_by": set(),
                "highlight": None,
                "highlight_score": 0.0,
            },
        )
        entry["score"] += score
        entry["matched_by"].add(source)
        if score >= entry["highlight_score"]:
            entry["highlight"] = self._build_search_highlight(text, query)
            entry["highlight_score"] = score

    def _register_search_hit(
        self,
        hit_map: dict[Any, dict[str, Any]],
        *,
        thread_id,
        source: str,
        text: str | None,
        score: float,
        query: str,
    ) -> None:
        self._register_generic_search_hit(
            hit_map,
            result_key=("thread", thread_id),
            source=source,
            text=text,
            score=score,
            query=query,
        )

    def _build_search_highlight(self, text: str, query: str, *, radius: int = 84) -> str:
        compact = " ".join(text.split())
        if not compact:
            return ""

        lowered_text = compact.lower()
        lowered_query = query.lower()
        index = lowered_text.find(lowered_query)
        if index == -1:
            return compact[: radius * 2] + ("..." if len(compact) > radius * 2 else "")

        start = max(index - radius, 0)
        end = min(index + len(query) + radius, len(compact))
        prefix = "..." if start > 0 else ""
        suffix = "..." if end < len(compact) else ""
        return f"{prefix}{compact[start:end]}{suffix}"

    def _metadata_matches_project(self, metadata: dict[str, Any] | None, project_id) -> bool:
        if project_id is None:
            return True
        if not isinstance(metadata, dict):
            return False

        project_id_text = str(project_id)
        direct_project_id = metadata.get("project_id")
        if direct_project_id is not None and str(direct_project_id) == project_id_text:
            return True

        project_ids = metadata.get("project_ids")
        if isinstance(project_ids, list) and project_id_text in {str(value) for value in project_ids}:
            return True

        project_payload = metadata.get("project")
        if isinstance(project_payload, dict):
            nested_id = project_payload.get("id")
            if nested_id is not None and str(nested_id) == project_id_text:
                return True

        return False

    def _document_search_tags(self, metadata: dict[str, Any] | None) -> list[str]:
        if not isinstance(metadata, dict):
            return []
        tags = metadata.get("tags")
        if not isinstance(tags, list):
            return []
        return [str(tag).strip() for tag in tags if str(tag).strip()]

    def _search_result_sort_key(
        self,
        *,
        result_key,
        projects_by_id: dict[Any, Project],
        threads_by_id: dict[Any, dict[str, Any]],
        documents_by_id: dict[Any, Document],
        artifacts_by_id: dict[Any, Artifact],
    ) -> datetime:
        kind, result_id = result_key
        if kind == "project":
            project = projects_by_id[result_id]
            return project.updated_at
        if kind == "thread":
            thread = threads_by_id[result_id]
            return thread.get("last_activity_at") or thread.get("updated_at") or utc_now()
        if kind == "document":
            return documents_by_id[result_id].created_at
        if kind == "artifact":
            return artifacts_by_id[result_id].created_at
        return utc_now()

    def _count_search_keys(self, result_keys: list[Any]) -> dict[str, int]:
        counts: dict[str, int] = {}
        for kind, _result_id in result_keys:
            kind = "task" if kind == "thread" else str(kind or "unknown")
            counts[kind] = counts.get(kind, 0) + 1
        return counts

    def _normalize_workbench_relative_path(self, relative_path: str | None) -> str:
        normalized = (relative_path or ".").replace("\\", "/").strip()
        if not normalized or normalized == "/":
            return "."
        normalized_path = Path(normalized)
        candidate = normalized_path.as_posix()
        return "." if candidate in {"", "."} else candidate

    def _parent_workbench_path(self, relative_path: str) -> str | None:
        if relative_path == ".":
            return None
        parent = Path(relative_path).parent.as_posix()
        return "." if parent in {"", "."} else parent
