from __future__ import annotations

import asyncio
import smtplib
from datetime import UTC, datetime
from email.message import EmailMessage
from email.utils import formataddr, make_msgid
from time import perf_counter
from typing import Any, Literal
from urllib.parse import quote

import httpx

from app.core.config import get_settings
from app.core.request_context import get_runtime_request_context
from app.services.approval_policy import SensitiveActionPolicy
from app.services.ops import ops_telemetry
from app.services.tools.common import ToolRuntimeBase

settings = get_settings()


class ExternalIntegrationTool(ToolRuntimeBase):
    name = "external_integrations"

    def __init__(self, *args, **kwargs) -> None:
        super().__init__(*args, **kwargs)
        self.policy = SensitiveActionPolicy()

    async def integration_status(self) -> dict[str, Any]:
        request = {"operation": "integration_status"}
        audit, started_at = self.start_audit("integration_status", request)
        payload = {
            "providers": [
                self._provider_status("email", self._email_provider() or "outbox", bool(self._email_provider()), "From SMTP or Resend when configured."),
                self._provider_status("slack", self._slack_provider() or "outbox", bool(self._slack_provider()), "Slack incoming webhook or bot token."),
                self._provider_status("webhook", "httpx", True, "Generic outbound webhooks with approval gating."),
                self._provider_status("calendar", self._calendar_provider() or "outbox", bool(self._calendar_provider()), "Google Calendar or Microsoft Graph."),
                self._provider_status("generic_http", "httpx", True, "Generic REST requests to external systems."),
            ],
            "capabilities": {
                "email": bool(self._email_provider()),
                "slack": bool(self._slack_provider()),
                "webhook": True,
                "calendar": bool(self._calendar_provider()),
                "generic_http": True,
            },
        }
        audit = self.finalize_audit(audit, started_at, status="completed", response=payload)
        return self.result(operation="integration_status", status="completed", payload=payload, audit=audit)

    async def preview_dispatch(self, prompt: str) -> dict[str, Any]:
        request = {"prompt_preview": prompt[:240]}
        audit, started_at = self.start_audit("preview_dispatch", request)
        payload = {
            "recommended_channels": ["email", "slack", "webhook", "calendar", "generic_http"],
            "note": "Live external delivery is supported when provider configuration exists and explicit approval language is supplied.",
        }
        audit = self.finalize_audit(audit, started_at, status="completed", response=payload)
        return self.result(operation="preview_dispatch", status="completed", payload=payload, audit=audit)

    async def send_email(
        self,
        *,
        to: str,
        subject: str,
        body: str,
        deliver: bool = False,
        approval_note: str | None = None,
    ) -> dict[str, Any]:
        request = {"channel": "email", "to": to, "subject": subject, "deliver": deliver}
        audit, started_at = self.start_audit("send_email", request)
        artifact = self._save_outbox("email", {"to": to, "subject": subject, "body": body, "deliver": deliver, "approval_note": approval_note}, audit["run_id"])
        if not deliver:
            return self._queued_result("send_email", self._email_provider() or "outbox", "email", "Email is queued until live delivery is requested.", artifact, audit, started_at)
        blocked = self._blocked_delivery("email_delivery", "send_email", self._email_provider() or "outbox", "email", approval_note, artifact, audit, started_at)
        if blocked is not None:
            return blocked
        provider = self._email_provider()
        if provider is None:
            return self._failed_result("send_email", "outbox", "email", "Configure SMTP or Resend credentials before requesting live email delivery.", artifact, audit, started_at)
        try:
            response_payload = await (self._send_via_resend(to=to, subject=subject, body=body) if provider == "resend" else self._send_via_smtp(to=to, subject=subject, body=body))
            self._record_provider_call(provider=provider, operation="send_email", started_at=started_at)
            payload = {
                "channel": "email",
                "provider": provider,
                "delivery_status": "delivered",
                "outbox": artifact,
                **response_payload,
            }
            audit = self.finalize_audit(audit, started_at, status="completed", response=payload, artifacts=[artifact])
            return self.result(operation="send_email", status="completed", payload=payload, audit=audit)
        except Exception as exc:
            return self._failed_result("send_email", provider, "email", f"{exc.__class__.__name__}: {exc}", artifact, audit, started_at)

    async def send_slack(
        self,
        *,
        channel: str,
        text: str,
        webhook_url: str | None = None,
        deliver: bool = False,
        approval_note: str | None = None,
        blocks: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        request = {"channel": "slack", "slack_channel": channel, "deliver": deliver, "has_webhook": bool(webhook_url)}
        audit, started_at = self.start_audit("send_slack", request)
        artifact = self._save_outbox("slack", {"channel": channel, "text": text, "blocks": blocks or [], "webhook_url": webhook_url, "deliver": deliver, "approval_note": approval_note}, audit["run_id"])
        if not deliver:
            return self._queued_result("send_slack", self._slack_provider(webhook_url) or "outbox", "slack", "Slack delivery is queued until live delivery is requested.", artifact, audit, started_at)
        blocked = self._blocked_delivery("slack_delivery", "send_slack", self._slack_provider(webhook_url) or "outbox", "slack", approval_note, artifact, audit, started_at)
        if blocked is not None:
            return blocked
        provider = self._slack_provider(webhook_url)
        if provider is None:
            return self._failed_result("send_slack", "outbox", "slack", "Configure a Slack webhook URL or bot token before requesting live Slack delivery.", artifact, audit, started_at)
        try:
            response_payload = await (self._send_to_slack_webhook(webhook_url=webhook_url or settings.slack_webhook_url or "", text=text, blocks=blocks) if provider == "slack_webhook" else self._send_to_slack_api(channel=channel, text=text, blocks=blocks))
            self._record_provider_call(provider=provider, operation="send_slack", started_at=started_at)
            payload = {
                "channel": "slack",
                "provider": provider,
                "delivery_status": "delivered",
                "outbox": artifact,
                **response_payload,
            }
            audit = self.finalize_audit(audit, started_at, status="completed", response=payload, artifacts=[artifact])
            return self.result(operation="send_slack", status="completed", payload=payload, audit=audit)
        except Exception as exc:
            return self._failed_result("send_slack", provider, "slack", f"{exc.__class__.__name__}: {exc}", artifact, audit, started_at)

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
        artifact = self._save_outbox("webhook", {"url": url, "payload": payload, "headers": headers or {}, "deliver": deliver, "approval_note": approval_note}, audit["run_id"])
        if not deliver:
            return self._queued_result("send_webhook", "httpx", "webhook", "Webhook delivery is queued until live delivery is requested.", artifact, audit, started_at)
        blocked = self._blocked_delivery("webhook_delivery", "send_webhook", "httpx", "webhook", approval_note, artifact, audit, started_at)
        if blocked is not None:
            return blocked
        try:
            response = await self._http_request(method="POST", url=url, headers=headers or {}, json_payload=payload)
            self._record_provider_call(provider="httpx", operation="send_webhook", started_at=started_at)
            data = {
                "channel": "webhook",
                "provider": "httpx",
                "delivery_status": "delivered" if response.is_success else "failed",
                "outbox": artifact,
                "response_status": response.status_code,
                "response_preview": response.text[:240],
            }
            audit = self.finalize_audit(audit, started_at, status="completed" if response.is_success else "failed", response=data, artifacts=[artifact], error=None if response.is_success else response.text[:500])
            return self.result(operation="send_webhook", status="completed" if response.is_success else "failed", payload=data, audit=audit)
        except Exception as exc:
            return self._failed_result("send_webhook", "httpx", "webhook", f"{exc.__class__.__name__}: {exc}", artifact, audit, started_at)

    async def create_calendar_event(
        self,
        *,
        title: str,
        start_at: str,
        end_at: str,
        description: str | None = None,
        location: str | None = None,
        attendees: list[str] | None = None,
        deliver: bool = False,
        approval_note: str | None = None,
        calendar_id: str | None = None,
    ) -> dict[str, Any]:
        request = {"channel": "calendar", "title": title, "start_at": start_at, "end_at": end_at, "deliver": deliver}
        audit, started_at = self.start_audit("create_calendar_event", request)
        artifact = self._save_outbox("calendar", {"title": title, "start_at": start_at, "end_at": end_at, "description": description, "location": location, "attendees": attendees or [], "deliver": deliver, "approval_note": approval_note, "calendar_id": calendar_id}, audit["run_id"])
        if not deliver:
            return self._queued_result("create_calendar_event", self._calendar_provider() or "outbox", "calendar", "Calendar delivery is queued until live delivery is requested.", artifact, audit, started_at)
        blocked = self._blocked_delivery("calendar_delivery", "create_calendar_event", self._calendar_provider() or "outbox", "calendar", approval_note, artifact, audit, started_at)
        if blocked is not None:
            return blocked
        provider = self._calendar_provider()
        if provider is None:
            return self._failed_result("create_calendar_event", "outbox", "calendar", "Configure Google Calendar or Microsoft Graph before requesting live calendar delivery.", artifact, audit, started_at)
        try:
            start_dt = self._parse_datetime(start_at)
            end_dt = self._parse_datetime(end_at)
            response_payload = await (self._create_google_calendar_event(title=title, start_at=start_dt, end_at=end_dt, description=description, location=location, attendees=attendees or [], calendar_id=calendar_id or settings.google_calendar_id) if provider == "google_calendar" else self._create_microsoft_calendar_event(title=title, start_at=start_dt, end_at=end_dt, description=description, location=location, attendees=attendees or [], calendar_id=calendar_id or settings.microsoft_calendar_id))
            self._record_provider_call(provider=provider, operation="create_calendar_event", started_at=started_at)
            data = {
                "channel": "calendar",
                "provider": provider,
                "delivery_status": "delivered",
                "outbox": artifact,
                **response_payload,
            }
            audit = self.finalize_audit(audit, started_at, status="completed", response=data, artifacts=[artifact])
            return self.result(operation="create_calendar_event", status="completed", payload=data, audit=audit)
        except Exception as exc:
            return self._failed_result("create_calendar_event", provider, "calendar", f"{exc.__class__.__name__}: {exc}", artifact, audit, started_at)

    async def invoke_endpoint(
        self,
        *,
        url: str,
        method: Literal["GET", "POST", "PUT", "PATCH", "DELETE"] = "POST",
        payload: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
        deliver: bool = False,
        approval_note: str | None = None,
    ) -> dict[str, Any]:
        request = {"channel": "generic_http", "url": url, "method": method, "deliver": deliver}
        audit, started_at = self.start_audit("invoke_endpoint", request)
        artifact = self._save_outbox("generic-http", {"url": url, "method": method, "payload": payload or {}, "headers": headers or {}, "deliver": deliver, "approval_note": approval_note}, audit["run_id"])
        if not deliver:
            return self._queued_result("invoke_endpoint", "generic_http", "generic_http", "External endpoint delivery is queued until live execution is requested.", artifact, audit, started_at)
        blocked = self._blocked_delivery("generic_http_delivery", "invoke_endpoint", "generic_http", "generic_http", approval_note, artifact, audit, started_at)
        if blocked is not None:
            return blocked
        try:
            response = await self._http_request(method=method, url=url, headers=headers or {}, json_payload=payload)
            self._record_provider_call(provider="generic_http", operation="invoke_endpoint", started_at=started_at)
            data = {
                "channel": "generic_http",
                "provider": "generic_http",
                "delivery_status": "delivered" if response.is_success else "failed",
                "outbox": artifact,
                "response_status": response.status_code,
                "response_preview": response.text[:400],
            }
            audit = self.finalize_audit(audit, started_at, status="completed" if response.is_success else "failed", response=data, artifacts=[artifact], error=None if response.is_success else response.text[:500])
            return self.result(operation="invoke_endpoint", status="completed" if response.is_success else "failed", payload=data, audit=audit)
        except Exception as exc:
            return self._failed_result("invoke_endpoint", "generic_http", "generic_http", f"{exc.__class__.__name__}: {exc}", artifact, audit, started_at)

    async def _send_via_resend(self, *, to: str, subject: str, body: str) -> dict[str, Any]:
        response = await self._http_request(
            method="POST",
            url=f"{settings.resend_base_url.rstrip('/')}/emails",
            headers={"Authorization": f"Bearer {settings.resend_api_key}", "Content-Type": "application/json"},
            json_payload={"from": self._from_email_address(), "to": [to], "subject": subject, "text": body},
        )
        response.raise_for_status()
        payload = response.json() if response.content else {}
        return {"message_id": payload.get("id"), "response_status": response.status_code, "response_preview": response.text[:240]}

    async def _send_via_smtp(self, *, to: str, subject: str, body: str) -> dict[str, Any]:
        def _send() -> dict[str, Any]:
            message = EmailMessage()
            message["Subject"] = subject
            message["From"] = self._from_email_address()
            message["To"] = to
            message["Message-ID"] = make_msgid()
            message.set_content(body)
            if settings.smtp_use_tls:
                with smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, timeout=settings.external_request_timeout_seconds) as server:
                    if settings.smtp_username:
                        server.login(settings.smtp_username, settings.smtp_password or "")
                    server.send_message(message)
            else:
                with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=settings.external_request_timeout_seconds) as server:
                    if settings.smtp_starttls:
                        server.starttls()
                    if settings.smtp_username:
                        server.login(settings.smtp_username, settings.smtp_password or "")
                    server.send_message(message)
            return {"message_id": message["Message-ID"], "response_status": 250}

        return await asyncio.to_thread(_send)

    async def _send_to_slack_webhook(self, *, webhook_url: str, text: str, blocks: list[dict[str, Any]] | None = None) -> dict[str, Any]:
        response = await self._http_request(method="POST", url=webhook_url, headers={"Content-Type": "application/json"}, json_payload={"text": text, "blocks": blocks or None})
        response.raise_for_status()
        return {"message_id": None, "response_status": response.status_code, "response_preview": response.text[:240]}

    async def _send_to_slack_api(self, *, channel: str, text: str, blocks: list[dict[str, Any]] | None = None) -> dict[str, Any]:
        response = await self._http_request(
            method="POST",
            url=f"{settings.slack_api_base_url.rstrip('/')}/chat.postMessage",
            headers={"Authorization": f"Bearer {settings.slack_bot_token}", "Content-Type": "application/json; charset=utf-8"},
            json_payload={"channel": channel, "text": text, "blocks": blocks or None},
        )
        response.raise_for_status()
        payload = response.json() if response.content else {}
        if not payload.get("ok", False):
            raise RuntimeError(payload.get("error", "Slack API rejected the message."))
        return {"message_id": payload.get("ts"), "response_status": response.status_code, "response_preview": response.text[:240]}

    async def _create_google_calendar_event(
        self,
        *,
        title: str,
        start_at: datetime,
        end_at: datetime,
        description: str | None,
        location: str | None,
        attendees: list[str],
        calendar_id: str,
    ) -> dict[str, Any]:
        response = await self._http_request(
            method="POST",
            url=f"{settings.google_calendar_base_url.rstrip('/')}/calendars/{quote(calendar_id, safe='')}/events",
            headers={"Authorization": f"Bearer {settings.google_calendar_access_token}", "Content-Type": "application/json"},
            json_payload={"summary": title, "description": description or "", "location": location or "", "start": {"dateTime": start_at.isoformat()}, "end": {"dateTime": end_at.isoformat()}, "attendees": [{"email": email} for email in attendees]},
        )
        response.raise_for_status()
        payload = response.json() if response.content else {}
        return {"event_id": payload.get("id"), "event_url": payload.get("htmlLink"), "response_status": response.status_code}

    async def _create_microsoft_calendar_event(
        self,
        *,
        title: str,
        start_at: datetime,
        end_at: datetime,
        description: str | None,
        location: str | None,
        attendees: list[str],
        calendar_id: str,
    ) -> dict[str, Any]:
        endpoint = f"{settings.microsoft_graph_base_url.rstrip('/')}/me/calendar/events" if calendar_id == "primary" else f"{settings.microsoft_graph_base_url.rstrip('/')}/me/calendars/{quote(calendar_id, safe='')}/events"
        response = await self._http_request(
            method="POST",
            url=endpoint,
            headers={"Authorization": f"Bearer {settings.microsoft_graph_access_token}", "Content-Type": "application/json"},
            json_payload={"subject": title, "body": {"contentType": "Text", "content": description or ""}, "start": {"dateTime": start_at.strftime("%Y-%m-%dT%H:%M:%S"), "timeZone": "UTC"}, "end": {"dateTime": end_at.strftime("%Y-%m-%dT%H:%M:%S"), "timeZone": "UTC"}, "location": {"displayName": location or ""}, "attendees": [{"emailAddress": {"address": email}, "type": "required"} for email in attendees]},
        )
        response.raise_for_status()
        payload = response.json() if response.content else {}
        return {"event_id": payload.get("id"), "event_url": payload.get("webLink"), "response_status": response.status_code}

    async def _http_request(self, *, method: str, url: str, headers: dict[str, str], json_payload: dict[str, Any] | None = None) -> httpx.Response:
        async with httpx.AsyncClient(timeout=settings.external_request_timeout_seconds) as client:
            return await client.request(method=method.upper(), url=url, headers=headers, json=json_payload)

    def _parse_datetime(self, raw: str) -> datetime:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=UTC)
        return parsed.astimezone(UTC)

    def _record_provider_call(self, *, provider: str, operation: str, started_at: float) -> None:
        runtime_context = get_runtime_request_context()
        ops_telemetry.record_provider_call(
            provider=provider,
            model=operation,
            operation="external_integration",
            latency_ms=int(round((perf_counter() - started_at) * 1000)),
            fallback=False,
            request_id=runtime_context.request_id,
            workspace_id=runtime_context.workspace_id,
        )

    def _blocked_delivery(
        self,
        action: str,
        operation: str,
        provider: str,
        channel: str,
        approval_note: str | None,
        artifact: dict[str, Any],
        audit: dict[str, Any],
        started_at: float,
    ) -> dict[str, Any] | None:
        decision = self.policy.evaluate_notification_delivery(deliver=True, approval_note=approval_note)
        runtime_context = get_runtime_request_context()
        if decision.allowed:
            ops_telemetry.record_sensitive_action(action=action, outcome="approved", reason=decision.reason, request_id=runtime_context.request_id, workspace_id=runtime_context.workspace_id)
            return None
        ops_telemetry.record_sensitive_action(action=action, outcome="blocked", reason=decision.reason, request_id=runtime_context.request_id, workspace_id=runtime_context.workspace_id)
        payload = {
            "channel": channel,
            "provider": provider,
            "delivery_status": "approval_required",
            "outbox": artifact,
            "reason": decision.reason,
        }
        audit = self.finalize_audit(audit, started_at, status="failed", response=payload, artifacts=[artifact], error=decision.reason)
        return self.result(operation=operation, status="failed", payload=payload, audit=audit)

    def _queued_result(
        self,
        operation: str,
        provider: str,
        channel: str,
        detail: str,
        artifact: dict[str, Any],
        audit: dict[str, Any],
        started_at: float,
    ) -> dict[str, Any]:
        payload = {
            "channel": channel,
            "provider": provider,
            "delivery_status": "queued",
            "outbox": artifact,
            "detail": detail,
        }
        audit = self.finalize_audit(audit, started_at, status="completed", response=payload, artifacts=[artifact])
        return self.result(operation=operation, status="completed", payload=payload, audit=audit)

    def _failed_result(
        self,
        operation: str,
        provider: str,
        channel: str,
        detail: str,
        artifact: dict[str, Any],
        audit: dict[str, Any],
        started_at: float,
    ) -> dict[str, Any]:
        payload = {
            "channel": channel,
            "provider": provider,
            "delivery_status": "failed",
            "outbox": artifact,
            "detail": detail,
        }
        audit = self.finalize_audit(audit, started_at, status="failed", response=payload, artifacts=[artifact], error=detail)
        return self.result(operation=operation, status="failed", payload=payload, audit=audit)

    def _provider_status(self, key: str, provider: str, configured: bool, detail: str) -> dict[str, Any]:
        return {"key": key, "provider": provider, "configured": configured, "live_delivery_supported": configured or key in {"webhook", "generic_http"}, "uses_approval_gate": True, "detail": detail}

    def _email_provider(self) -> str | None:
        if settings.resend_api_key:
            return "resend"
        if settings.smtp_host and settings.smtp_from_email:
            return "smtp"
        return None

    def _slack_provider(self, webhook_url: str | None = None) -> str | None:
        if webhook_url or settings.slack_webhook_url:
            return "slack_webhook"
        if settings.slack_bot_token:
            return "slack_bot"
        return None

    def _calendar_provider(self) -> str | None:
        if settings.google_calendar_access_token:
            return "google_calendar"
        if settings.microsoft_graph_access_token:
            return "microsoft_calendar"
        return None

    def _from_email_address(self) -> str:
        address = settings.smtp_from_email or "noreply@localhost"
        return formataddr((settings.email_from_name, address)) if settings.email_from_name else address

    def _save_outbox(self, channel: str, payload: dict[str, Any], run_id: str) -> dict[str, Any]:
        storage_key = f"integrations/outbox/{channel}/{run_id}.json"
        return {"storage_key": storage_key, "path": self.storage.save_json(storage_key, payload), "content_type": "application/json"}
