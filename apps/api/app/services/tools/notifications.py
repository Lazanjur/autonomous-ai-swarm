from __future__ import annotations

from typing import Any

import httpx

from app.core.request_context import get_runtime_request_context
from app.services.approval_policy import SensitiveActionPolicy
from app.services.ops import ops_telemetry
from app.services.tools.common import ToolRuntimeBase


class NotificationDispatchTool(ToolRuntimeBase):
    name = "notification_dispatch"

    def __init__(self, *args, **kwargs) -> None:
        super().__init__(*args, **kwargs)
        self.policy = SensitiveActionPolicy()

    async def queue_email(
        self,
        *,
        to: str,
        subject: str,
        body: str,
        deliver: bool = False,
        approval_note: str | None = None,
    ) -> dict[str, Any]:
        request = {"channel": "email", "to": to, "subject": subject, "deliver": deliver}
        audit, started_at = self.start_audit("queue_email", request)
        artifact = self._save_outbox(
            "email",
            {"to": to, "subject": subject, "body": body, "deliver": deliver, "approval_note": approval_note},
            audit["run_id"],
        )
        status = "queued" if not deliver else "queued"
        payload = {
            "channel": "email",
            "status": status,
            "outbox": artifact,
            "note": "Email delivery is represented as an outbox record in this environment.",
        }
        audit = self.finalize_audit(audit, started_at, status="completed", response=payload, artifacts=[artifact])
        return self.result(operation="queue_email", status="completed", payload=payload, audit=audit)

    async def queue_slack(
        self,
        *,
        channel: str,
        text: str,
        webhook_url: str | None = None,
        deliver: bool = False,
        approval_note: str | None = None,
    ) -> dict[str, Any]:
        request = {
            "channel": "slack",
            "slack_channel": channel,
            "deliver": deliver,
            "has_webhook": bool(webhook_url),
        }
        audit, started_at = self.start_audit("queue_slack", request)
        artifact = self._save_outbox(
            "slack",
            {
                "channel": channel,
                "text": text,
                "webhook_url": webhook_url,
                "deliver": deliver,
                "approval_note": approval_note,
            },
            audit["run_id"],
        )
        payload = {
            "channel": "slack",
            "status": "queued",
            "outbox": artifact,
            "note": "Slack delivery is queued as an outbox record unless a dedicated sender is wired.",
        }
        audit = self.finalize_audit(audit, started_at, status="completed", response=payload, artifacts=[artifact])
        return self.result(operation="queue_slack", status="completed", payload=payload, audit=audit)

    async def send_webhook(
        self,
        *,
        url: str,
        payload: dict[str, Any],
        headers: dict[str, str] | None = None,
        deliver: bool = False,
        approval_note: str | None = None,
    ) -> dict[str, Any]:
        request = {"channel": "webhook", "url": url, "deliver": deliver}
        audit, started_at = self.start_audit("send_webhook", request)
        decision = self.policy.evaluate_notification_delivery(deliver=deliver, approval_note=approval_note)
        artifact = self._save_outbox(
            "webhook",
            {
                "url": url,
                "payload": payload,
                "headers": headers or {},
                "deliver": deliver,
                "approval_note": approval_note,
            },
            audit["run_id"],
        )
        runtime_context = get_runtime_request_context()
        if not deliver:
            result_payload = {
                "channel": "webhook",
                "status": "queued",
                "outbox": artifact,
                "response_status": None,
            }
            audit = self.finalize_audit(
                audit,
                started_at,
                status="completed",
                response=result_payload,
                artifacts=[artifact],
            )
            return self.result(operation="send_webhook", status="completed", payload=result_payload, audit=audit)

        if not decision.allowed:
            ops_telemetry.record_sensitive_action(
                action="external_notification_delivery",
                outcome="blocked",
                reason=decision.reason,
                request_id=runtime_context.request_id,
                workspace_id=runtime_context.workspace_id,
            )
            result_payload = {
                "channel": "webhook",
                "status": "approval_required",
                "outbox": artifact,
                "response_status": None,
                "reason": decision.reason,
            }
            audit = self.finalize_audit(
                audit,
                started_at,
                status="failed",
                response=result_payload,
                artifacts=[artifact],
                error=decision.reason,
            )
            return self.result(operation="send_webhook", status="failed", payload=result_payload, audit=audit)

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.post(url, json=payload, headers=headers or {})
            ops_telemetry.record_sensitive_action(
                action="external_notification_delivery",
                outcome="approved",
                reason=decision.reason,
                request_id=runtime_context.request_id,
                workspace_id=runtime_context.workspace_id,
            )
            result_payload = {
                "channel": "webhook",
                "status": "delivered" if response.is_success else "failed",
                "outbox": artifact,
                "response_status": response.status_code,
                "response_preview": response.text[:240],
            }
            audit = self.finalize_audit(
                audit,
                started_at,
                status="completed" if response.is_success else "failed",
                response=result_payload,
                artifacts=[artifact],
                error=None if response.is_success else response.text[:500],
            )
            return self.result(
                operation="send_webhook",
                status="completed" if response.is_success else "failed",
                payload=result_payload,
                audit=audit,
            )
        except Exception as exc:
            result_payload = {
                "channel": "webhook",
                "status": "failed",
                "outbox": artifact,
                "response_status": None,
            }
            audit = self.finalize_audit(
                audit,
                started_at,
                status="failed",
                response=result_payload,
                artifacts=[artifact],
                error=f"{exc.__class__.__name__}: {exc}",
            )
            return self.result(operation="send_webhook", status="failed", payload=result_payload, audit=audit)

    async def preview_dispatch(self, prompt: str) -> dict[str, Any]:
        request = {"prompt_preview": prompt[:240]}
        audit, started_at = self.start_audit("preview_dispatch", request)
        payload = {
            "recommended_channels": [
                "email",
                "slack",
                "webhook",
            ],
            "note": "Notifications default to durable outbox records unless an explicit delivery path is approved.",
        }
        audit = self.finalize_audit(audit, started_at, status="completed", response=payload)
        return self.result(operation="preview_dispatch", status="completed", payload=payload, audit=audit)

    def _save_outbox(self, channel: str, payload: dict[str, Any], run_id: str) -> dict[str, Any]:
        storage_key = f"notifications/outbox/{channel}/{run_id}.json"
        return {
            "storage_key": storage_key,
            "path": self.storage.save_json(storage_key, payload),
            "content_type": "application/json",
        }
