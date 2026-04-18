from __future__ import annotations

import asyncio
from datetime import datetime, timedelta
from typing import Any
from typing import Sequence
from uuid import UUID

from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.db.session import SessionLocal
from app.models.entities import AuditLog, Automation, AutomationExecution, utc_now
from app.schemas.automations import (
    AutomationCreateRequest,
    AutomationDashboardRead,
    AutomationExecutionRead,
    AutomationRead,
    AutomationRuntimeSummaryRead,
    AutomationUpdateRequest,
)
from app.schemas.chat import ChatRunRequest
from app.services.automation_schedule import next_occurrence, summarize_schedule
from app.services.tools.notifications import NotificationDispatchTool
from app.services.workflows.run_service import RunService

settings = get_settings()


class AutomationService:
    def __init__(self) -> None:
        self.run_service = RunService()
        self.notifications = NotificationDispatchTool()

    async def list_automations(
        self,
        session: AsyncSession,
        *,
        workspace_ids: Sequence[UUID],
        workspace_id: UUID | None = None,
    ) -> list[Automation]:
        statement = select(Automation).order_by(Automation.created_at.desc())
        if workspace_id is not None:
            statement = statement.where(Automation.workspace_id == workspace_id)
        else:
            statement = statement.where(Automation.workspace_id.in_(workspace_ids))
        return list((await session.execute(statement)).scalars().all())

    async def get_automation(self, session: AsyncSession, automation_id: UUID) -> Automation | None:
        return (await session.execute(select(Automation).where(Automation.id == automation_id))).scalar_one_or_none()

    async def list_executions(
        self,
        session: AsyncSession,
        automation_id: UUID,
        *,
        limit: int = 10,
    ) -> list[AutomationExecution]:
        statement = (
            select(AutomationExecution)
            .where(AutomationExecution.automation_id == automation_id)
            .order_by(desc(AutomationExecution.created_at))
            .limit(limit)
        )
        return list((await session.execute(statement)).scalars().all())

    async def create_automation(
        self,
        session: AsyncSession,
        payload: AutomationCreateRequest,
        *,
        actor_id: UUID | None = None,
    ) -> Automation:
        if not payload.name.strip() or not payload.description.strip() or not payload.prompt.strip():
            raise ValueError("Automation name, description, and prompt are required.")
        next_run_at = next_occurrence(payload.schedule, payload.timezone)
        automation = Automation(
            workspace_id=payload.workspace_id,
            name=payload.name.strip(),
            description=payload.description.strip(),
            schedule=payload.schedule.strip(),
            status="active",
            definition={
                "prompt": payload.prompt,
                "template_key": payload.template_key,
                "timezone": payload.timezone,
                "use_retrieval": payload.use_retrieval,
                "requires_approval": payload.requires_approval,
                "retry_limit": payload.retry_limit,
                "timeout_seconds": payload.timeout_seconds,
                "notify_channels": payload.notify_channels,
                "notify_on": payload.notify_on,
                "steps": payload.steps,
            },
            next_run_at=next_run_at,
        )
        session.add(automation)
        session.add(
            AuditLog(
                actor_id=actor_id,
                workspace_id=payload.workspace_id,
                action="automation.created",
                resource_type="automation",
                resource_id=str(automation.id),
                details={"schedule": payload.schedule, "next_run_at": next_run_at.isoformat()},
            )
        )
        await session.commit()
        await session.refresh(automation)
        return automation

    async def update_automation(
        self,
        session: AsyncSession,
        automation: Automation,
        payload: AutomationUpdateRequest,
        *,
        actor_id: UUID | None = None,
    ) -> Automation:
        definition = dict(automation.definition)
        if payload.name is not None:
            automation.name = payload.name.strip()
        if payload.description is not None:
            automation.description = payload.description.strip()
        if payload.schedule is not None:
            automation.schedule = payload.schedule.strip()
        if payload.status is not None:
            self._validate_status(payload.status)
            automation.status = payload.status
        if payload.prompt is not None:
            definition["prompt"] = payload.prompt
        if payload.template_key is not None:
            definition["template_key"] = payload.template_key
        if payload.timezone is not None:
            definition["timezone"] = payload.timezone
        if payload.use_retrieval is not None:
            definition["use_retrieval"] = payload.use_retrieval
        if payload.requires_approval is not None:
            definition["requires_approval"] = payload.requires_approval
        if payload.retry_limit is not None:
            definition["retry_limit"] = payload.retry_limit
        if payload.timeout_seconds is not None:
            definition["timeout_seconds"] = payload.timeout_seconds
        if payload.notify_channels is not None:
            definition["notify_channels"] = payload.notify_channels
        if payload.notify_on is not None:
            definition["notify_on"] = payload.notify_on
        if payload.steps is not None:
            definition["steps"] = payload.steps
        automation.definition = definition
        if automation.status == "active":
            automation.next_run_at = next_occurrence(
                automation.schedule,
                self._timezone_for(automation),
            )
        elif automation.status in {"paused", "awaiting_approval"}:
            automation.next_run_at = None

        session.add(
            AuditLog(
                actor_id=actor_id,
                workspace_id=automation.workspace_id,
                action="automation.updated",
                resource_type="automation",
                resource_id=str(automation.id),
                details={"status": automation.status, "schedule": automation.schedule},
            )
        )
        await session.commit()
        await session.refresh(automation)
        return automation

    async def get_dashboard(
        self,
        session: AsyncSession,
        automation: Automation,
    ) -> AutomationDashboardRead:
        executions = await self.list_executions(session, automation.id, limit=8)
        return AutomationDashboardRead(
            automation=AutomationRead.model_validate(automation),
            recent_executions=[AutomationExecutionRead.model_validate(item) for item in executions],
            schedule_summary=summarize_schedule(automation.schedule, self._timezone_for(automation)),
            pending_approval=any(item.status == "awaiting_approval" for item in executions),
            runtime=AutomationRuntimeSummaryRead.model_validate(
                self._build_runtime_summary(automation, executions)
            ),
        )

    async def execute_automation(
        self,
        session: AsyncSession,
        automation: Automation,
        *,
        trigger: str = "manual",
        actor_id: UUID | None = None,
        force: bool = False,
    ) -> AutomationExecution:
        if force:
            pending = await self.get_pending_approval_execution(session, automation.id)
            if pending is not None:
                return await self.approve_execution(
                    session,
                    automation=automation,
                    execution=pending,
                    actor_id=actor_id,
                )

        if not force:
            inflight = await self.get_inflight_execution(session, automation.id)
            if inflight is not None:
                return inflight

        if automation.definition.get("requires_approval") and not force and trigger == "scheduled":
            automation.next_run_at = None
            execution = await self._create_execution(
                session,
                automation=automation,
                trigger=trigger,
                status="awaiting_approval",
                attempt=1,
                result_summary="Scheduled run paused pending manual approval.",
            )
            execution_metadata = self._ensure_execution_metadata(execution)
            execution_metadata["approval"] = {
                "required": True,
                "state": "awaiting_approval",
                "requested_at": utc_now().isoformat(),
                "trigger": trigger,
                "decision_note": None,
                "decision_by": None,
                "decided_at": None,
            }
            execution.metadata_ = self._append_event(
                execution_metadata,
                event_type="approval.requested",
                message="Scheduled execution is waiting for a human decision.",
                level="warning",
                data={"trigger": trigger},
            )
            queued_notifications = await self._queue_notifications(
                automation=automation,
                execution=execution,
                event_name="approval_requested",
            )
            if queued_notifications:
                execution_metadata = self._ensure_execution_metadata(execution)
                execution.metadata_["notifications"] = (
                    list(execution_metadata.get("notifications", [])) + queued_notifications
                )[-settings.automation_notification_history_limit :]
                execution.metadata_ = self._append_event(
                    execution.metadata_,
                    event_type="notification.queued",
                    message=f"Queued {len(queued_notifications)} notification(s) for the approval gate.",
                    data={"count": len(queued_notifications), "event_name": "approval_requested"},
                )
            automation.status = "awaiting_approval"
            automation.next_run_at = None
            await session.commit()
            await session.refresh(execution)
            return execution

        execution = await self._create_execution(
            session,
            automation=automation,
            trigger=trigger,
            status="queued",
            attempt=1,
        )
        if trigger == "scheduled":
            automation.next_run_at = None
        await session.commit()
        await session.refresh(execution)
        return await self._run_execution(
            session,
            automation=automation,
            execution=execution,
            actor_id=actor_id,
        )

    async def get_pending_approval_execution(
        self,
        session: AsyncSession,
        automation_id: UUID,
    ) -> AutomationExecution | None:
        if not hasattr(session, "execute"):
            return None
        statement = (
            select(AutomationExecution)
            .where(AutomationExecution.automation_id == automation_id)
            .where(AutomationExecution.status == "awaiting_approval")
            .order_by(desc(AutomationExecution.created_at))
            .limit(1)
        )
        return (await session.execute(statement)).scalar_one_or_none()

    async def get_inflight_execution(
        self,
        session: AsyncSession,
        automation_id: UUID,
    ) -> AutomationExecution | None:
        if not hasattr(session, "execute"):
            return None
        statement = (
            select(AutomationExecution)
            .where(AutomationExecution.automation_id == automation_id)
            .where(AutomationExecution.status.in_(("queued", "running", "retry_scheduled", "awaiting_approval")))
            .order_by(desc(AutomationExecution.created_at))
            .limit(1)
        )
        return (await session.execute(statement)).scalar_one_or_none()

    async def approve_pending_automation(
        self,
        session: AsyncSession,
        automation: Automation,
        *,
        actor_id: UUID | None = None,
        decision_note: str | None = None,
    ) -> AutomationExecution:
        execution = await self.get_pending_approval_execution(session, automation.id)
        if execution is None:
            raise ValueError("No approval-gated execution is waiting for a decision.")
        return await self.approve_execution(
            session,
            automation=automation,
            execution=execution,
            actor_id=actor_id,
            decision_note=decision_note,
        )

    async def reject_pending_automation(
        self,
        session: AsyncSession,
        automation: Automation,
        *,
        actor_id: UUID | None = None,
        decision_note: str | None = None,
    ) -> AutomationExecution:
        execution = await self.get_pending_approval_execution(session, automation.id)
        if execution is None:
            raise ValueError("No approval-gated execution is waiting for a decision.")

        execution.status = "rejected"
        execution.completed_at = utc_now()
        execution.result_summary = "Automation execution was rejected at the approval gate."
        execution.metadata_["approval"] = {
            "required": True,
            "state": "rejected",
            "requested_at": self._approval_requested_at(execution),
            "trigger": execution.trigger,
            "decision_note": decision_note,
            "decision_by": str(actor_id) if actor_id else None,
            "decided_at": utc_now().isoformat(),
        }
        execution.metadata_ = self._append_event(
            execution.metadata_,
            event_type="approval.rejected",
            message="Execution was rejected and removed from the worker queue.",
            level="warning",
            data={"decision_note": decision_note or ""},
        )
        queued_notifications = await self._queue_notifications(
            automation=automation,
            execution=execution,
            event_name="rejected",
        )
        if queued_notifications:
            execution.metadata_["notifications"] = (
                list(execution.metadata_.get("notifications", [])) + queued_notifications
            )[-settings.automation_notification_history_limit :]
            execution.metadata_ = self._append_event(
                execution.metadata_,
                event_type="notification.queued",
                message=f"Queued {len(queued_notifications)} notification(s) for the rejection outcome.",
                data={"count": len(queued_notifications), "event_name": "rejected"},
            )
        automation.status = "active"
        automation.next_run_at = next_occurrence(automation.schedule, self._timezone_for(automation))
        session.add(
            AuditLog(
                actor_id=actor_id,
                workspace_id=automation.workspace_id,
                action="automation.execution.rejected",
                resource_type="automation",
                resource_id=str(automation.id),
                details={"execution_id": str(execution.id), "decision_note": decision_note},
            )
        )
        await session.commit()
        await session.refresh(execution)
        await session.refresh(automation)
        return execution

    async def process_due_automations(
        self,
        session: AsyncSession,
        *,
        limit: int = 5,
    ) -> tuple[int, int]:
        now = utc_now()
        await self._initialize_missing_next_run_at(session)
        due_statement = (
            select(Automation)
            .where(Automation.status == "active")
            .where(Automation.next_run_at.is_not(None))
            .where(Automation.next_run_at <= now)
            .order_by(Automation.next_run_at)
            .limit(limit)
        )
        automations = list((await session.execute(due_statement)).scalars().all())
        started = 0
        for automation in automations:
            await self.execute_automation(session, automation, trigger="scheduled", actor_id=None)
            started += 1
        retry_started = await self.process_retry_queue(session, limit=limit)
        return len(automations), started + retry_started

    async def process_retry_queue(
        self,
        session: AsyncSession,
        *,
        limit: int = 5,
    ) -> int:
        statement = (
            select(AutomationExecution)
            .where(AutomationExecution.status == "retry_scheduled")
            .order_by(AutomationExecution.created_at)
            .limit(limit * 5)
        )
        candidates = list((await session.execute(statement)).scalars().all())
        started = 0
        now = utc_now()
        for execution in candidates:
            retry_at = self._retry_next_at(execution)
            if retry_at is None or retry_at > now:
                continue
            automation = await self.get_automation(session, execution.automation_id)
            if automation is None or automation.status != "active":
                continue
            execution.attempt += 1
            execution.status = "queued"
            execution.metadata_ = self._append_event(
                execution.metadata_,
                event_type="retry.requeued",
                message=f"Retry attempt {execution.attempt} returned to the worker queue.",
                data={"attempt": execution.attempt},
            )
            await session.commit()
            await self._run_execution(
                session,
                automation=automation,
                execution=execution,
                actor_id=None,
            )
            started += 1
            if started >= limit:
                break
        return started

    async def _initialize_missing_next_run_at(self, session: AsyncSession) -> None:
        automations = list(
            (
                await session.execute(
                    select(Automation).where(Automation.status == "active").where(Automation.next_run_at.is_(None))
                )
            ).scalars().all()
        )
        if not automations:
            return
        for automation in automations:
            automation.next_run_at = next_occurrence(automation.schedule, self._timezone_for(automation))
        await session.commit()

    def _build_runtime_summary(
        self,
        automation: Automation,
        executions: list[AutomationExecution],
    ) -> dict[str, Any]:
        recent_threshold = utc_now() - timedelta(hours=24)
        recent = [item for item in executions if item.created_at >= recent_threshold]
        active_execution_count = sum(item.status in {"queued", "running"} for item in executions)
        awaiting_approval_count = sum(item.status == "awaiting_approval" for item in executions)
        retry_scheduled_count = sum(item.status == "retry_scheduled" for item in executions)
        latest_event = None
        latest_notification = None
        retry_state = None
        approval = None

        for execution in executions:
            events = execution.metadata_.get("events", [])
            notifications = execution.metadata_.get("notifications", [])
            if latest_event is None and events:
                latest_event = events[-1]
            if latest_notification is None and notifications:
                latest_notification = notifications[-1]
            if retry_state is None and execution.metadata_.get("retry_state"):
                retry_state = execution.metadata_.get("retry_state")
            if approval is None and execution.metadata_.get("approval"):
                approval = execution.metadata_.get("approval")

        if awaiting_approval_count:
            queue_status = "awaiting_approval"
        elif retry_scheduled_count:
            queue_status = "retry_scheduled"
        elif active_execution_count:
            queue_status = "running"
        else:
            queue_status = "idle"

        return {
            "queue_status": queue_status,
            "scheduler_enabled": settings.automation_scheduler_enabled,
            "poll_interval_seconds": settings.automation_poll_interval_seconds,
            "active_execution_count": active_execution_count,
            "awaiting_approval_count": awaiting_approval_count,
            "retry_scheduled_count": retry_scheduled_count,
            "completed_executions_24h": sum(item.status == "completed" for item in recent),
            "failed_executions_24h": sum(item.status == "failed" for item in recent),
            "latest_event": latest_event,
            "latest_notification": latest_notification,
            "retry_state": retry_state,
            "approval": approval,
        }

    def _base_execution_metadata(self, automation: Automation, *, trigger: str, attempt: int) -> dict[str, Any]:
        retry_limit = self._retry_limit_for(automation)
        return {
            "schedule": automation.schedule,
            "timezone": self._timezone_for(automation),
            "events": [],
            "notifications": [],
            "approval": {
                "required": bool(automation.definition.get("requires_approval", False)),
                "state": "not_required",
                "requested_at": None,
                "trigger": trigger,
                "decision_note": None,
                "decision_by": None,
                "decided_at": None,
            },
            "retry_state": {
                "retry_limit": retry_limit,
                "attempts_used": attempt,
                "attempts_remaining": max(retry_limit - max(attempt - 1, 0), 0),
                "retryable": retry_limit > 0,
                "next_retry_at": None,
                "backoff_seconds": None,
                "last_error": None,
            },
        }

    def _ensure_execution_metadata(self, execution: AutomationExecution | Any) -> dict[str, Any]:
        metadata = getattr(execution, "metadata_", None)
        if isinstance(metadata, dict):
            return metadata
        metadata = getattr(execution, "metadata", None)
        if not isinstance(metadata, dict):
            metadata = {}
        setattr(execution, "metadata_", metadata)
        return metadata

    def _append_event(
        self,
        metadata: dict[str, Any],
        *,
        event_type: str,
        message: str,
        level: str = "info",
        data: dict[str, Any] | None = None,
        timestamp=None,
    ) -> dict[str, Any]:
        next_metadata = dict(metadata or {})
        events = list(next_metadata.get("events", []))
        events.append(
            {
                "timestamp": (timestamp or utc_now()).isoformat(),
                "type": event_type,
                "level": level,
                "message": message,
                "data": data or {},
            }
        )
        next_metadata["events"] = events[-24:]
        return next_metadata

    def _retry_state(
        self,
        *,
        execution: AutomationExecution,
        automation: Automation,
        next_retry_at,
        backoff_seconds: int | None,
        last_error: str | None,
        retryable: bool,
    ) -> dict[str, Any]:
        retry_limit = self._retry_limit_for(automation)
        return {
            "retry_limit": retry_limit,
            "attempts_used": execution.attempt,
            "attempts_remaining": max(retry_limit - max(execution.attempt - 1, 0), 0),
            "retryable": retryable,
            "next_retry_at": next_retry_at.isoformat() if next_retry_at else None,
            "backoff_seconds": backoff_seconds,
            "last_error": last_error,
        }

    def _retry_next_at(self, execution: AutomationExecution):
        raw = self._ensure_execution_metadata(execution).get("retry_state", {}).get("next_retry_at")
        if not raw:
            return None
        try:
            return datetime.fromisoformat(str(raw))
        except Exception:
            return None

    def _approval_requested_at(self, execution: AutomationExecution) -> str | None:
        approval = self._ensure_execution_metadata(execution).get("approval", {})
        if isinstance(approval, dict) and approval.get("requested_at"):
            return str(approval.get("requested_at"))
        return execution.created_at.isoformat()

    async def _queue_notifications(
        self,
        *,
        automation: Automation,
        execution: AutomationExecution,
        event_name: str,
    ) -> list[dict[str, Any]]:
        notify_events = {
            str(value).strip().lower()
            for value in automation.definition.get("notify_on", ["failed"])
            if str(value).strip()
        }
        if event_name not in notify_events:
            return []

        subject = f"[{automation.name}] {event_name.title()} automation execution"
        summary = execution.result_summary or execution.error_message or "Automation execution updated."
        body = (
            f"Automation: {automation.name}\n"
            f"Status: {execution.status}\n"
            f"Trigger: {execution.trigger}\n"
            f"Attempt: {execution.attempt}\n"
            f"Summary: {summary}\n"
        )

        entries: list[dict[str, Any]] = []
        for channel_spec in automation.definition.get("notify_channels", []):
            raw = str(channel_spec).strip()
            if not raw:
                continue
            channel, _, target = raw.partition(":")
            channel = channel.strip().lower()
            target = target.strip()
            timestamp = utc_now().isoformat()
            try:
                if channel == "email" and target:
                    result = await self.notifications.queue_email(
                        to=target,
                        subject=subject,
                        body=body,
                        deliver=False,
                    )
                    entries.append(
                        {
                            "channel": "email",
                            "target": target,
                            "event": event_name,
                            "status": result.get("status", "queued"),
                            "storage_key": result.get("outbox", {}).get("storage_key"),
                            "response_status": None,
                            "detail": result.get("detail") or result.get("note"),
                            "timestamp": timestamp,
                        }
                    )
                elif channel == "slack" and target:
                    result = await self.notifications.queue_slack(
                        channel=target,
                        text=body,
                        deliver=False,
                    )
                    entries.append(
                        {
                            "channel": "slack",
                            "target": target,
                            "event": event_name,
                            "status": result.get("status", "queued"),
                            "storage_key": result.get("outbox", {}).get("storage_key"),
                            "response_status": None,
                            "detail": result.get("detail") or result.get("note"),
                            "timestamp": timestamp,
                        }
                    )
                elif channel == "webhook" and target:
                    result = await self.notifications.send_webhook(
                        url=target,
                        payload={
                            "automation_id": str(automation.id),
                            "automation_name": automation.name,
                            "status": execution.status,
                            "attempt": execution.attempt,
                            "summary": summary,
                            "run_id": str(execution.run_id) if execution.run_id else None,
                            "thread_id": str(execution.thread_id) if execution.thread_id else None,
                        },
                        deliver=False,
                    )
                    entries.append(
                        {
                            "channel": "webhook",
                            "target": target,
                            "event": event_name,
                            "status": result.get("status", "queued"),
                            "storage_key": result.get("outbox", {}).get("storage_key"),
                            "response_status": result.get("response_status"),
                            "detail": result.get("reason") or result.get("detail") or result.get("note"),
                            "timestamp": timestamp,
                        }
                    )
                else:
                    entries.append(
                        {
                            "channel": channel or "unknown",
                            "target": target or None,
                            "event": event_name,
                            "status": "skipped",
                            "storage_key": None,
                            "response_status": None,
                            "detail": "Unsupported notification channel format.",
                            "timestamp": timestamp,
                        }
                    )
            except Exception as exc:
                entries.append(
                    {
                        "channel": channel or "unknown",
                        "target": target or None,
                        "event": event_name,
                        "status": "failed",
                        "storage_key": None,
                        "response_status": None,
                        "detail": f"{exc.__class__.__name__}: {exc}",
                        "timestamp": timestamp,
                    }
                )
        return entries[-settings.automation_notification_history_limit :]

    async def _create_execution(
        self,
        session: AsyncSession,
        *,
        automation: Automation,
        trigger: str,
        status: str,
        attempt: int,
        result_summary: str | None = None,
    ) -> AutomationExecution:
        started_at = utc_now()
        execution = AutomationExecution(
            automation_id=automation.id,
            workspace_id=automation.workspace_id,
            status=status,
            trigger=trigger,
            attempt=attempt,
            started_at=started_at,
            completed_at=started_at if status == "awaiting_approval" else None,
            result_summary=result_summary,
            metadata=self._append_event(
                self._base_execution_metadata(automation, trigger=trigger, attempt=attempt),
                event_type="execution.created",
                message=f"Execution created with status `{status}`.",
                data={"attempt": attempt, "trigger": trigger},
                timestamp=started_at,
            ),
        )
        session.add(execution)
        await session.flush()
        return execution

    async def approve_execution(
        self,
        session: AsyncSession,
        *,
        automation: Automation,
        execution: AutomationExecution,
        actor_id: UUID | None = None,
        decision_note: str | None = None,
    ) -> AutomationExecution:
        execution.status = "queued"
        execution.completed_at = None
        execution.metadata_["approval"] = {
            "required": True,
            "state": "approved",
            "requested_at": self._approval_requested_at(execution),
            "trigger": execution.trigger,
            "decision_note": decision_note,
            "decision_by": str(actor_id) if actor_id else None,
            "decided_at": utc_now().isoformat(),
        }
        execution.metadata_ = self._append_event(
            execution.metadata_,
            event_type="approval.approved",
            message="Approval granted. Execution returned to the worker queue.",
            data={"decision_note": decision_note or ""},
        )
        automation.status = "active"
        automation.next_run_at = None
        await session.commit()
        return await self._run_execution(
            session,
            automation=automation,
            execution=execution,
            actor_id=actor_id,
        )

    async def _run_execution(
        self,
        session: AsyncSession,
        *,
        automation: Automation,
        execution: AutomationExecution,
        actor_id: UUID | None = None,
    ) -> AutomationExecution:
        execution.status = "running"
        execution.started_at = execution.started_at or utc_now()
        self._ensure_execution_metadata(execution)
        execution.metadata_ = self._append_event(
            execution.metadata_,
            event_type="worker.started",
            message=f"Worker started automation attempt {execution.attempt}.",
            data={"attempt": execution.attempt, "timeout_seconds": self._timeout_for(automation)},
        )
        await session.commit()

        try:
            thread_id = automation.definition.get("target_thread_id")
            payload = ChatRunRequest(
                workspace_id=automation.workspace_id,
                thread_id=UUID(str(thread_id)) if thread_id else None,
                message=self._automation_prompt(automation),
                mode="autonomous",
                use_retrieval=bool(automation.definition.get("use_retrieval", True)),
                execution_environment=(
                    automation.definition.get("execution_environment")
                    if isinstance(automation.definition.get("execution_environment"), dict)
                    else None
                ),
            )
            thread, run, _ = await asyncio.wait_for(
                self.run_service.create_run(session, payload, actor_id=actor_id),
                timeout=self._timeout_for(automation),
            )
            execution.run_id = run.id
            execution.thread_id = thread.id
            execution.status = "completed"
            execution.completed_at = utc_now()
            execution.result_summary = run.summary or (run.final_response or "")[:500]
            execution.error_message = None
            execution.metadata_["run_status"] = run.status
            execution.metadata_["retry_state"] = self._retry_state(
                execution=execution,
                automation=automation,
                next_retry_at=None,
                backoff_seconds=None,
                last_error=None,
                retryable=False,
            )
            execution.metadata_ = self._append_event(
                execution.metadata_,
                event_type="run.completed",
                message="Automation produced a completed run.",
                data={"run_id": str(run.id), "thread_id": str(thread.id), "status": run.status},
            )
            queued_notifications = await self._queue_notifications(
                automation=automation,
                execution=execution,
                event_name="completed",
            )
            if queued_notifications:
                execution.metadata_["notifications"] = (
                    list(execution.metadata_.get("notifications", [])) + queued_notifications
                )[-settings.automation_notification_history_limit :]
                execution.metadata_ = self._append_event(
                    execution.metadata_,
                    event_type="notification.queued",
                    message=f"Queued {len(queued_notifications)} notification(s) for the completion event.",
                    data={"count": len(queued_notifications), "event_name": "completed"},
                )
            automation.last_run_at = utc_now()
            automation.status = "active"
            automation.next_run_at = next_occurrence(automation.schedule, self._timezone_for(automation))
            automation.definition = {**automation.definition, "target_thread_id": str(thread.id)}
            session.add(
                AuditLog(
                    actor_id=actor_id,
                    workspace_id=automation.workspace_id,
                    action="automation.execution.completed",
                    resource_type="automation",
                    resource_id=str(automation.id),
                    details={"execution_id": str(execution.id), "run_id": str(run.id)},
                )
            )
            await session.commit()
            await session.refresh(execution)
            await session.refresh(automation)
            return execution
        except Exception as exc:
            error_message = f"{exc.__class__.__name__}: {exc}"[:1000]
            retry_limit = self._retry_limit_for(automation)
            retryable = execution.attempt <= retry_limit
            if retryable:
                backoff_seconds = settings.automation_retry_backoff_seconds * execution.attempt
                next_retry_at = utc_now() + timedelta(seconds=backoff_seconds)
                execution.status = "retry_scheduled"
                execution.completed_at = None
                execution.error_message = error_message
                execution.result_summary = f"Attempt {execution.attempt} failed. Retry scheduled."
                automation.status = "active"
                automation.next_run_at = None
                execution.metadata_["retry_state"] = self._retry_state(
                    execution=execution,
                    automation=automation,
                    next_retry_at=next_retry_at,
                    backoff_seconds=backoff_seconds,
                    last_error=error_message,
                    retryable=True,
                )
                execution.metadata_ = self._append_event(
                    execution.metadata_,
                    event_type="retry.scheduled",
                    message=f"Attempt {execution.attempt} failed. Retry scheduled.",
                    level="warning",
                    data={
                        "attempt": execution.attempt,
                        "next_retry_at": next_retry_at.isoformat(),
                        "backoff_seconds": backoff_seconds,
                    },
                )
                queued_notifications = await self._queue_notifications(
                    automation=automation,
                    execution=execution,
                    event_name="retry_scheduled",
                )
                if queued_notifications:
                    execution.metadata_["notifications"] = (
                        list(execution.metadata_.get("notifications", [])) + queued_notifications
                    )[-settings.automation_notification_history_limit :]
                    execution.metadata_ = self._append_event(
                        execution.metadata_,
                        event_type="notification.queued",
                        message=f"Queued {len(queued_notifications)} notification(s) for the retry schedule.",
                        data={"count": len(queued_notifications), "event_name": "retry_scheduled"},
                    )
                session.add(
                    AuditLog(
                        actor_id=actor_id,
                        workspace_id=automation.workspace_id,
                        action="automation.execution.retry_scheduled",
                        resource_type="automation",
                        resource_id=str(automation.id),
                        details={
                            "execution_id": str(execution.id),
                            "attempt": execution.attempt,
                            "next_retry_at": next_retry_at.isoformat(),
                            "error": error_message,
                        },
                    )
                )
                await session.commit()
                await session.refresh(execution)
                return execution

            execution.status = "failed"
            execution.completed_at = utc_now()
            execution.error_message = error_message
            execution.result_summary = "Automation run failed."
            execution.metadata_["retry_state"] = self._retry_state(
                execution=execution,
                automation=automation,
                next_retry_at=None,
                backoff_seconds=None,
                last_error=error_message,
                retryable=False,
            )
            execution.metadata_ = self._append_event(
                execution.metadata_,
                event_type="execution.failed",
                message="Execution failed after exhausting its retry budget.",
                level="error",
                data={"attempt": execution.attempt, "error": error_message},
            )
            queued_notifications = await self._queue_notifications(
                automation=automation,
                execution=execution,
                event_name="failed",
            )
            if queued_notifications:
                execution.metadata_["notifications"] = (
                    list(execution.metadata_.get("notifications", [])) + queued_notifications
                )[-settings.automation_notification_history_limit :]
                execution.metadata_ = self._append_event(
                    execution.metadata_,
                    event_type="notification.queued",
                    message=f"Queued {len(queued_notifications)} notification(s) for the failure event.",
                    data={"count": len(queued_notifications), "event_name": "failed"},
                )
            automation.status = "active"
            automation.next_run_at = next_occurrence(automation.schedule, self._timezone_for(automation))
            session.add(
                AuditLog(
                    actor_id=actor_id,
                    workspace_id=automation.workspace_id,
                    action="automation.execution.failed",
                    resource_type="automation",
                    resource_id=str(automation.id),
                    details={"execution_id": str(execution.id), "attempt": execution.attempt, "error": error_message},
                )
            )
            await session.commit()
            await session.refresh(execution)
            await session.refresh(automation)
            return execution

    def _timezone_for(self, automation: Automation) -> str:
        return str(automation.definition.get("timezone") or "UTC")

    def _retry_limit_for(self, automation: Automation) -> int:
        return int(automation.definition.get("retry_limit", settings.automation_default_retry_limit))

    def _timeout_for(self, automation: Automation) -> int:
        return int(automation.definition.get("timeout_seconds", settings.automation_default_timeout_seconds))

    def _automation_prompt(self, automation: Automation) -> str:
        steps = automation.definition.get("steps") or []
        if not steps:
            return str(automation.definition.get("prompt", automation.description))
        numbered_steps = "\n".join(f"{index + 1}. {step}" for index, step in enumerate(steps))
        return f"{automation.definition.get('prompt', automation.description)}\n\nExecution checklist:\n{numbered_steps}"

    def _validate_status(self, status: str) -> None:
        if status not in {"active", "paused", "awaiting_approval"}:
            raise ValueError("Automation status must be `active`, `paused`, or `awaiting_approval`.")


class AutomationScheduler:
    def __init__(self) -> None:
        self._task: asyncio.Task[None] | None = None
        self._lock = asyncio.Lock()

    async def start(self) -> None:
        if not settings.automation_scheduler_enabled or self._task is not None:
            return
        self._task = asyncio.create_task(self._run_loop())

    async def stop(self) -> None:
        if self._task is None:
            return
        self._task.cancel()
        try:
            await self._task
        except asyncio.CancelledError:
            pass
        finally:
            self._task = None

    async def run_tick(self) -> tuple[int, int]:
        async with self._lock:
            async with SessionLocal() as session:
                service = AutomationService()
                return await service.process_due_automations(session)

    async def _run_loop(self) -> None:
        while True:
            try:
                await self.run_tick()
            except Exception:
                pass
            await asyncio.sleep(max(5, settings.automation_poll_interval_seconds))
