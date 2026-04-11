from __future__ import annotations

import asyncio
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
    AutomationUpdateRequest,
)
from app.schemas.chat import ChatRunRequest
from app.services.automation_schedule import next_occurrence, summarize_schedule
from app.services.workflows.run_service import RunService

settings = get_settings()


class AutomationService:
    def __init__(self) -> None:
        self.run_service = RunService()

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
                "timezone": payload.timezone,
                "use_retrieval": payload.use_retrieval,
                "requires_approval": payload.requires_approval,
                "retry_limit": payload.retry_limit,
                "timeout_seconds": payload.timeout_seconds,
                "notify_channels": payload.notify_channels,
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
            pending_approval=automation.status == "awaiting_approval",
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
        if automation.definition.get("requires_approval") and not force and trigger == "scheduled":
            execution = await self._create_execution(
                session,
                automation=automation,
                trigger=trigger,
                status="awaiting_approval",
                attempt=1,
                result_summary="Scheduled run paused pending manual approval.",
            )
            automation.status = "awaiting_approval"
            automation.next_run_at = None
            await session.commit()
            return execution

        retry_limit = int(automation.definition.get("retry_limit", settings.automation_default_retry_limit))
        prior_status = automation.status
        last_execution: AutomationExecution | None = None
        for attempt in range(1, retry_limit + 2):
            execution = await self._create_execution(
                session,
                automation=automation,
                trigger=trigger,
                status="running",
                attempt=attempt,
            )
            last_execution = execution
            try:
                thread_id = automation.definition.get("target_thread_id")
                payload = ChatRunRequest(
                    workspace_id=automation.workspace_id,
                    thread_id=UUID(str(thread_id)) if thread_id else None,
                    message=self._automation_prompt(automation),
                    mode="autonomous",
                    use_retrieval=bool(automation.definition.get("use_retrieval", True)),
                )
                thread, run, _ = await self.run_service.create_run(session, payload, actor_id=actor_id)
                execution.run_id = run.id
                execution.thread_id = thread.id
                execution.status = "completed"
                execution.completed_at = utc_now()
                execution.result_summary = run.summary or (run.final_response or "")[:500]
                execution.metadata = {
                    **execution.metadata,
                    "run_status": run.status,
                    "notifications_planned": automation.definition.get("notify_channels", []),
                }
                automation.last_run_at = utc_now()
                if prior_status == "paused" and trigger == "manual":
                    automation.status = "paused"
                    automation.next_run_at = None
                else:
                    automation.status = "active"
                    automation.next_run_at = next_occurrence(automation.schedule, self._timezone_for(automation))
                automation.definition = {
                    **automation.definition,
                    "target_thread_id": str(thread.id),
                }
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
                execution.status = "failed"
                execution.completed_at = utc_now()
                execution.error_message = str(exc)[:1000]
                execution.result_summary = "Automation run failed."
                execution.metadata = {**execution.metadata, "attempt_failed": True}
                automation.next_run_at = (
                    None
                    if prior_status == "paused" and trigger == "manual"
                    else next_occurrence(automation.schedule, self._timezone_for(automation))
                )
                session.add(
                    AuditLog(
                        actor_id=actor_id,
                        workspace_id=automation.workspace_id,
                        action="automation.execution.failed",
                        resource_type="automation",
                        resource_id=str(automation.id),
                        details={"execution_id": str(execution.id), "attempt": attempt, "error": str(exc)[:1000]},
                    )
                )
                await session.commit()
                if attempt > retry_limit:
                    break

        assert last_execution is not None
        return last_execution

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
        return len(automations), started

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
        execution = AutomationExecution(
            automation_id=automation.id,
            workspace_id=automation.workspace_id,
            status=status,
            trigger=trigger,
            attempt=attempt,
            started_at=utc_now(),
            completed_at=utc_now() if status == "awaiting_approval" else None,
            result_summary=result_summary,
            metadata={"schedule": automation.schedule, "timezone": self._timezone_for(automation)},
        )
        session.add(execution)
        await session.flush()
        return execution

    def _timezone_for(self, automation: Automation) -> str:
        return str(automation.definition.get("timezone") or "UTC")

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
