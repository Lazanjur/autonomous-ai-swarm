from __future__ import annotations

from typing import Any

from app.models.entities import utc_now
from app.services.tools.common import ToolRuntimeBase


class BackgroundJobTool(ToolRuntimeBase):
    name = "background_job"

    async def enqueue(
        self,
        *,
        job_type: str,
        payload: dict[str, Any],
        priority: str = "normal",
    ) -> dict[str, Any]:
        request = {"job_type": job_type, "priority": priority}
        audit, started_at = self.start_audit("enqueue", request)
        queued_at = utc_now().isoformat()
        record = {
            "job_id": audit["run_id"],
            "job_type": job_type,
            "priority": priority,
            "status": "queued",
            "queued_at": queued_at,
            "payload": payload,
        }
        storage_key = f"jobs/queue/{priority}/{audit['run_id']}.json"
        artifact = {
            "storage_key": storage_key,
            "path": self.storage.save_json(storage_key, record),
            "content_type": "application/json",
        }
        result_payload = {
            "job_id": audit["run_id"],
            "job_type": job_type,
            "priority": priority,
            "status": "queued",
            "queued_at": queued_at,
            "artifact": artifact,
        }
        audit = self.finalize_audit(
            audit,
            started_at,
            status="completed",
            response=result_payload,
            artifacts=[artifact],
        )
        return self.result(operation="enqueue", status="completed", payload=result_payload, audit=audit)

    async def preview(self, prompt: str) -> dict[str, Any]:
        request = {"prompt_preview": prompt[:240]}
        audit, started_at = self.start_audit("preview", request)
        payload = {
            "recommended_job_types": ["report_generation", "dataset_processing", "bulk_browser_run"],
            "note": "Queue long-running work here when inline execution would exceed normal chat latency.",
            "trigger_terms": ["background", "long-running", "async", "batch", "bulk", "queue"],
        }
        audit = self.finalize_audit(audit, started_at, status="completed", response=payload)
        return self.result(operation="preview", status="completed", payload=payload, audit=audit)
