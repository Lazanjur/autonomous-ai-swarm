from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.models.entities import utc_now
from app.services.automation_runtime import AutomationService
from app.services.automation_schedule import next_occurrence, parse_schedule, summarize_schedule


def test_parse_schedule_supports_weekdays():
    definition = parse_schedule("weekdays@08:15", "Europe/Zagreb")

    assert definition.kind == "weekly"
    assert definition.hour == 8
    assert definition.minute == 15
    assert definition.weekdays == (0, 1, 2, 3, 4)


def test_summarize_schedule_is_human_readable():
    summary = summarize_schedule("weekly:mon,wed@09:30", "UTC")

    assert "Mon, Wed" in summary
    assert "09:30" in summary


def test_next_occurrence_returns_future_datetime():
    after = datetime(2026, 4, 10, 7, 0, tzinfo=timezone.utc)
    candidate = next_occurrence("daily@08:00", "UTC", after=after)

    assert candidate > after
    assert candidate.hour == 8
    assert candidate.minute == 0


class DummySession:
    def add(self, _item):
        return None

    async def commit(self):
        return None

    async def flush(self):
        return None

    async def refresh(self, _item):
        return None


@pytest.mark.asyncio
async def test_execute_automation_updates_execution_and_thread(monkeypatch):
    service = AutomationService()
    session = DummySession()
    automation = SimpleNamespace(
        id=uuid4(),
        workspace_id=uuid4(),
        name="Board digest",
        description="Create a digest.",
        schedule="daily@08:00",
        status="active",
        definition={
            "prompt": "Create the board digest.",
            "timezone": "UTC",
            "use_retrieval": True,
            "requires_approval": False,
            "retry_limit": 0,
            "timeout_seconds": 900,
            "notify_channels": ["email:ops@example.com"],
            "steps": ["Review latest runs", "Summarize changes"],
        },
        last_run_at=None,
        next_run_at=None,
    )
    execution = SimpleNamespace(
        id=uuid4(),
        automation_id=automation.id,
        workspace_id=automation.workspace_id,
        run_id=None,
        thread_id=None,
        status="running",
        trigger="manual",
        attempt=1,
        started_at=utc_now(),
        completed_at=None,
        error_message=None,
        result_summary=None,
        metadata={},
    )

    async def fake_create_execution(session, *, automation, trigger, status, attempt, result_summary=None):
        execution.status = status
        execution.trigger = trigger
        execution.attempt = attempt
        execution.result_summary = result_summary
        return execution

    async def fake_create_run(session, payload, *, actor_id=None):
        thread = SimpleNamespace(id=uuid4())
        run = SimpleNamespace(id=uuid4(), status="completed", summary="Digest ready.", final_response="Digest ready.")
        return thread, run, []

    monkeypatch.setattr(service, "_create_execution", fake_create_execution)
    monkeypatch.setattr(service.run_service, "create_run", fake_create_run)

    result = await service.execute_automation(session, automation, trigger="manual", actor_id=uuid4())

    assert result.status == "completed"
    assert result.run_id is not None
    assert result.thread_id is not None
    assert automation.definition["target_thread_id"] == str(result.thread_id)
    assert automation.status == "active"
    assert automation.next_run_at is not None


@pytest.mark.asyncio
async def test_scheduled_approval_required_creates_awaiting_execution(monkeypatch):
    service = AutomationService()
    session = DummySession()
    automation = SimpleNamespace(
        id=uuid4(),
        workspace_id=uuid4(),
        name="Regulatory watch",
        description="Watch regulations.",
        schedule="daily@08:00",
        status="active",
        definition={"prompt": "Monitor regulations.", "timezone": "UTC", "requires_approval": True},
        next_run_at=utc_now(),
    )
    awaiting = SimpleNamespace(
        id=uuid4(),
        automation_id=automation.id,
        workspace_id=automation.workspace_id,
        status="awaiting_approval",
        trigger="scheduled",
        attempt=1,
        result_summary="Scheduled run paused pending manual approval.",
    )

    async def fake_create_execution(session, *, automation, trigger, status, attempt, result_summary=None):
        awaiting.status = status
        awaiting.trigger = trigger
        awaiting.result_summary = result_summary
        return awaiting

    monkeypatch.setattr(service, "_create_execution", fake_create_execution)

    result = await service.execute_automation(session, automation, trigger="scheduled")

    assert result.status == "awaiting_approval"
    assert automation.status == "awaiting_approval"
    assert automation.next_run_at is None


@pytest.mark.asyncio
async def test_execute_automation_returns_existing_inflight_execution(monkeypatch):
    service = AutomationService()
    session = DummySession()
    automation = SimpleNamespace(
        id=uuid4(),
        workspace_id=uuid4(),
        name="Board digest",
        description="Create a digest.",
        schedule="daily@08:00",
        status="active",
        definition={"prompt": "Create the board digest.", "timezone": "UTC", "requires_approval": False},
    )
    inflight = SimpleNamespace(
        id=uuid4(),
        automation_id=automation.id,
        workspace_id=automation.workspace_id,
        status="running",
    )

    async def fake_inflight(session, automation_id):
        return inflight

    monkeypatch.setattr(service, "get_inflight_execution", fake_inflight)

    result = await service.execute_automation(session, automation, trigger="manual")

    assert result is inflight


@pytest.mark.asyncio
async def test_scheduled_approval_execution_queues_notification_history(monkeypatch):
    service = AutomationService()
    session = DummySession()
    automation = SimpleNamespace(
        id=uuid4(),
        workspace_id=uuid4(),
        name="Regulatory watch",
        description="Watch regulations.",
        schedule="daily@08:00",
        status="active",
        definition={
            "prompt": "Monitor regulations.",
            "timezone": "UTC",
            "requires_approval": True,
            "notify_on": ["approval_requested"],
            "notify_channels": ["email:ops@example.com"],
        },
        next_run_at=utc_now(),
    )
    awaiting = SimpleNamespace(
        id=uuid4(),
        automation_id=automation.id,
        workspace_id=automation.workspace_id,
        status="awaiting_approval",
        trigger="scheduled",
        attempt=1,
        result_summary="Scheduled run paused pending manual approval.",
        metadata={},
    )

    async def fake_create_execution(session, *, automation, trigger, status, attempt, result_summary=None):
        awaiting.status = status
        awaiting.trigger = trigger
        awaiting.result_summary = result_summary
        awaiting.metadata_ = service._base_execution_metadata(automation, trigger=trigger, attempt=attempt)
        return awaiting

    async def fake_queue_notifications(*, automation, execution, event_name):
        return [
            {
                "channel": "email",
                "target": "ops@example.com",
                "event": event_name,
                "status": "queued",
                "storage_key": "notifications/outbox/email/test.json",
                "response_status": None,
                "detail": "Queued",
                "timestamp": utc_now().isoformat(),
            }
        ]

    monkeypatch.setattr(service, "_create_execution", fake_create_execution)
    monkeypatch.setattr(service, "_queue_notifications", fake_queue_notifications)

    result = await service.execute_automation(session, automation, trigger="scheduled")

    assert result.status == "awaiting_approval"
    assert result.metadata_["notifications"][0]["event"] == "approval_requested"
    assert any(event["type"] == "notification.queued" for event in result.metadata_["events"])


def test_retry_state_counts_remaining_retry_slots():
    service = AutomationService()
    automation = SimpleNamespace(definition={"retry_limit": 2})
    execution = SimpleNamespace(attempt=1)

    first_attempt = service._retry_state(
        execution=execution,
        automation=automation,
        next_retry_at=None,
        backoff_seconds=None,
        last_error=None,
        retryable=True,
    )
    execution.attempt = 2
    second_attempt = service._retry_state(
        execution=execution,
        automation=automation,
        next_retry_at=None,
        backoff_seconds=None,
        last_error=None,
        retryable=True,
    )

    assert first_attempt["attempts_remaining"] == 2
    assert second_attempt["attempts_remaining"] == 1
