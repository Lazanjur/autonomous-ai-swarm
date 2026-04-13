from __future__ import annotations

from typing import Any

from app.services.tools.integrations import ExternalIntegrationTool


class NotificationDispatchTool(ExternalIntegrationTool):
    name = "notification_dispatch"

    def _save_outbox(self, channel: str, payload: dict[str, Any], run_id: str) -> dict[str, Any]:
        storage_key = f"notifications/outbox/{channel}/{run_id}.json"
        return {
            "storage_key": storage_key,
            "path": self.storage.save_json(storage_key, payload),
            "content_type": "application/json",
        }

    async def queue_email(
        self,
        *,
        to: str,
        subject: str,
        body: str,
        deliver: bool = False,
        approval_note: str | None = None,
    ) -> dict[str, Any]:
        return await self.send_email(
            to=to,
            subject=subject,
            body=body,
            deliver=deliver,
            approval_note=approval_note,
        )

    async def queue_slack(
        self,
        *,
        channel: str,
        text: str,
        webhook_url: str | None = None,
        deliver: bool = False,
        approval_note: str | None = None,
    ) -> dict[str, Any]:
        return await self.send_slack(
            channel=channel,
            text=text,
            webhook_url=webhook_url,
            deliver=deliver,
            approval_note=approval_note,
        )
