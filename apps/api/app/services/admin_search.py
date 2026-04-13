from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas.auth import WorkspaceAccessRead
from app.services.workflows.run_service import RunService


class AdminSearchService:
    def __init__(self) -> None:
        self.run_service = RunService()

    async def search(
        self,
        session: AsyncSession,
        *,
        query: str,
        accessible_workspaces: list[WorkspaceAccessRead],
        workspace_id: UUID | None = None,
        limit: int = 40,
    ) -> dict[str, Any]:
        normalized_query = " ".join(query.split()).strip()
        workspace_map = {workspace.workspace_id: workspace for workspace in accessible_workspaces}
        target_workspaces = (
            [workspace_map[workspace_id]]
            if workspace_id is not None and workspace_id in workspace_map
            else accessible_workspaces
        )
        scope = "workspace" if workspace_id is not None else "global"

        if not normalized_query:
            return {
                "query": "",
                "scope": scope,
                "workspace_id": workspace_id,
                "workspace_count": len(target_workspaces),
                "total_results": 0,
                "result_counts": {},
                "results": [],
            }

        raw_results: list[dict[str, Any]] = []
        per_workspace_limit = max(limit, 24)
        for workspace in target_workspaces:
            runtime = await self.run_service.search_workspace(
                session,
                workspace_id=workspace.workspace_id,
                query=normalized_query,
                limit=per_workspace_limit,
            )
            for result in runtime["results"]:
                built = self._build_result_entry(
                    workspace=workspace,
                    result=result,
                )
                if built is not None:
                    raw_results.append(built)

        ordered_results = sorted(
            raw_results,
            key=lambda item: (
                float(item["score"]),
                item.get("sort_at") or datetime.min,
            ),
            reverse=True,
        )
        result_counts = self._count_results(ordered_results)
        results = [
            {key: value for key, value in result.items() if key != "sort_at"}
            for result in ordered_results[:limit]
        ]

        return {
            "query": normalized_query,
            "scope": scope,
            "workspace_id": workspace_id,
            "workspace_count": len(target_workspaces),
            "total_results": len(ordered_results),
            "result_counts": result_counts,
            "results": results,
        }

    def _build_result_entry(
        self,
        *,
        workspace: WorkspaceAccessRead,
        result: dict[str, Any],
    ) -> dict[str, Any] | None:
        kind = str(result.get("kind") or "").strip()
        if not kind:
            return None

        base = {
            "kind": kind,
            "workspace_id": workspace.workspace_id,
            "workspace_name": workspace.workspace_name,
            "workspace_slug": workspace.workspace_slug,
            "score": float(result.get("score") or 0.0),
            "matched_by": list(result.get("matched_by") or []),
            "highlight": result.get("highlight"),
            "project_id": None,
            "project_name": None,
            "thread_id": None,
            "document_id": None,
            "artifact_id": None,
            "title": "",
            "subtitle": None,
            "status": None,
            "created_at": None,
            "updated_at": None,
            "sort_at": None,
        }

        if kind == "project":
            project = result.get("project") or {}
            base.update(
                {
                    "project_id": project.get("id"),
                    "project_name": project.get("name"),
                    "title": str(project.get("name") or "Untitled project"),
                    "subtitle": project.get("description") or "Project result",
                    "status": project.get("status"),
                    "created_at": project.get("created_at"),
                    "updated_at": project.get("updated_at"),
                    "sort_at": project.get("updated_at") or project.get("created_at"),
                }
            )
            return base

        if kind == "task":
            thread = result.get("thread") or {}
            base.update(
                {
                    "project_id": thread.get("project_id"),
                    "thread_id": thread.get("id"),
                    "title": str(thread.get("title") or "Untitled task"),
                    "subtitle": thread.get("last_message_preview") or "Task history result",
                    "status": thread.get("status"),
                    "created_at": thread.get("created_at"),
                    "updated_at": thread.get("last_activity_at") or thread.get("updated_at"),
                    "sort_at": thread.get("last_activity_at") or thread.get("updated_at") or thread.get("created_at"),
                }
            )
            return base

        if kind == "document":
            document = result.get("document") or {}
            base.update(
                {
                    "document_id": document.get("id"),
                    "title": str(document.get("title") or "Untitled document"),
                    "subtitle": document.get("source_uri") or document.get("source_type") or "Document result",
                    "status": document.get("status"),
                    "created_at": document.get("created_at"),
                    "updated_at": document.get("created_at"),
                    "sort_at": document.get("created_at"),
                }
            )
            return base

        if kind == "artifact":
            artifact = result.get("artifact") or {}
            base.update(
                {
                    "document_id": artifact.get("document_id"),
                    "artifact_id": artifact.get("id"),
                    "title": str(artifact.get("title") or "Untitled artifact"),
                    "subtitle": artifact.get("storage_key") or artifact.get("kind") or "Artifact result",
                    "status": artifact.get("kind"),
                    "created_at": artifact.get("created_at"),
                    "updated_at": artifact.get("created_at"),
                    "sort_at": artifact.get("created_at"),
                }
            )
            return base

        return None

    def _count_results(self, results: list[dict[str, Any]]) -> dict[str, int]:
        counts: dict[str, int] = {}
        for result in results:
            kind = str(result.get("kind") or "unknown")
            counts[kind] = counts.get(kind, 0) + 1
        return counts
