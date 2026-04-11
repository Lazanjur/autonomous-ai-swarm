from __future__ import annotations

from time import perf_counter
from typing import Any
from uuid import uuid4

from app.models.entities import utc_now
from app.services.storage import StorageService


class ToolRuntimeBase:
    name = "tool"

    def __init__(self, storage: StorageService | None = None) -> None:
        self.storage = storage or StorageService()

    def start_audit(self, operation: str, request: dict[str, Any]) -> tuple[dict[str, Any], float]:
        run_id = uuid4().hex
        started_at = utc_now()
        audit = {
            "tool": self.name,
            "operation": operation,
            "run_id": run_id,
            "started_at": started_at.isoformat(),
            "request": request,
            "status": "running",
        }
        return audit, perf_counter()

    def finalize_audit(
        self,
        audit: dict[str, Any],
        started_at: float,
        *,
        status: str,
        response: dict[str, Any] | None = None,
        artifacts: list[dict[str, Any]] | None = None,
        error: str | None = None,
    ) -> dict[str, Any]:
        finished_at = utc_now()
        audit["status"] = status
        audit["finished_at"] = finished_at.isoformat()
        audit["duration_ms"] = round((perf_counter() - started_at) * 1000, 2)
        audit["artifacts"] = artifacts or []
        if response is not None:
            audit["response"] = response
        if error:
            audit["error"] = error
        audit_key = f"tool-audit/{self.name}/{audit['run_id']}.json"
        audit["storage_key"] = audit_key
        audit["path"] = self.storage.save_json(audit_key, audit)
        return audit

    def result(
        self,
        *,
        operation: str,
        status: str,
        payload: dict[str, Any],
        audit: dict[str, Any],
    ) -> dict[str, Any]:
        return {
            "tool": self.name,
            "operation": operation,
            "status": status,
            **payload,
            "audit": audit,
        }
