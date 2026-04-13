import pytest

from app.services.tools.integrations import ExternalIntegrationTool, settings as integration_settings


class FakeStorage:
    def __init__(self) -> None:
        self.saved: dict[str, object] = {}

    def save_json(self, key: str, payload):
        self.saved[key] = payload
        return f"/fake/{key}"


@pytest.mark.asyncio
async def test_send_email_uses_configured_provider(monkeypatch):
    tool = ExternalIntegrationTool(storage=FakeStorage())

    monkeypatch.setattr(integration_settings, "resend_api_key", "resend_test")
    monkeypatch.setattr(tool, "_send_via_resend", lambda **kwargs: _async_result({"message_id": "msg_123", "response_status": 200}))
    monkeypatch.setattr(tool, "_record_provider_call", lambda **kwargs: None)

    result = await tool.send_email(
        to="ops@example.com",
        subject="Launch",
        body="Ship it.",
        deliver=True,
        approval_note="delivery approved",
    )

    assert result["status"] == "completed"
    assert result["provider"] == "resend"
    assert result["channel"] == "email"


@pytest.mark.asyncio
async def test_send_slack_supports_live_webhook_delivery(monkeypatch):
    tool = ExternalIntegrationTool(storage=FakeStorage())

    monkeypatch.setattr(integration_settings, "slack_webhook_url", "https://hooks.slack.test")
    monkeypatch.setattr(tool, "_send_to_slack_webhook", lambda **kwargs: _async_result({"message_id": None, "response_status": 200}))
    monkeypatch.setattr(tool, "_record_provider_call", lambda **kwargs: None)

    result = await tool.send_slack(
        channel="#ops",
        text="Deployment finished",
        deliver=True,
        approval_note="delivery approved",
    )

    assert result["status"] == "completed"
    assert result["provider"] == "slack_webhook"


@pytest.mark.asyncio
async def test_create_calendar_event_supports_google_calendar(monkeypatch):
    tool = ExternalIntegrationTool(storage=FakeStorage())

    monkeypatch.setattr(integration_settings, "google_calendar_access_token", "google_test")
    monkeypatch.setattr(tool, "_create_google_calendar_event", lambda **kwargs: _async_result({"event_id": "evt_123", "event_url": "https://calendar.google.test"}))
    monkeypatch.setattr(tool, "_record_provider_call", lambda **kwargs: None)

    result = await tool.create_calendar_event(
        title="Launch review",
        start_at="2026-04-12T10:00:00Z",
        end_at="2026-04-12T11:00:00Z",
        attendees=["ops@example.com"],
        deliver=True,
        approval_note="delivery approved",
    )

    assert result["status"] == "completed"
    assert result["provider"] == "google_calendar"
    assert result["event_id"] == "evt_123"


@pytest.mark.asyncio
async def test_invoke_endpoint_requires_explicit_approval():
    tool = ExternalIntegrationTool(storage=FakeStorage())

    result = await tool.invoke_endpoint(
        url="https://example.com/hooks",
        method="POST",
        payload={"ok": True},
        deliver=True,
    )

    assert result["status"] == "failed"
    assert result["channel"] == "generic_http"
    assert result["status"] == "failed"
    assert result["reason"] == "Live external delivery requires explicit approval language."


@pytest.mark.asyncio
async def test_integration_status_reports_capabilities(monkeypatch):
    tool = ExternalIntegrationTool(storage=FakeStorage())

    monkeypatch.setattr(integration_settings, "smtp_host", "smtp.example.com")
    monkeypatch.setattr(integration_settings, "smtp_from_email", "ops@example.com")
    monkeypatch.setattr(integration_settings, "slack_webhook_url", "https://hooks.slack.test")

    result = await tool.integration_status()

    assert result["status"] == "completed"
    assert result["capabilities"]["email"] is True
    assert result["capabilities"]["slack"] is True
    assert result["capabilities"]["generic_http"] is True


async def _async_result(payload):
    return payload
