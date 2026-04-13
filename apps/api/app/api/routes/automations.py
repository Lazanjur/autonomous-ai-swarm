from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import AuthContext, require_auth_context
from app.db.session import get_session
from app.schemas.automations import (
    AutomationApprovalRequest,
    AutomationCreateRequest,
    AutomationDashboardRead,
    AutomationExecutionRead,
    AutomationRead,
    AutomationRunRequest,
    AutomationSchedulerTickResponse,
    AutomationUpdateRequest,
)
from app.services.auth import AuthService
from app.services.automation_runtime import AutomationScheduler, AutomationService

router = APIRouter()
auth_service = AuthService()
automation_service = AutomationService()
scheduler = AutomationScheduler()


async def _get_authorized_automation(
    session: AsyncSession,
    context: AuthContext,
    automation_id: UUID,
    *,
    min_role: str,
):
    automation = await automation_service.get_automation(session, automation_id)
    if automation is None:
        raise HTTPException(status_code=404, detail="Automation not found.")
    await auth_service.assert_workspace_access(
        session,
        user_id=context.user.id,
        workspace_id=automation.workspace_id,
        min_role=min_role,
    )
    return automation


@router.get("", response_model=list[AutomationRead])
async def list_automations(
    workspace_id: UUID | None = Query(default=None),
    context: AuthContext = Depends(require_auth_context),
    session: AsyncSession = Depends(get_session),
) -> list[AutomationRead]:
    access = await auth_service.list_workspace_access(session, context.user.id)
    allowed_workspace_ids = [workspace.workspace_id for workspace in access]
    if workspace_id is not None:
        await auth_service.assert_workspace_access(
            session,
            user_id=context.user.id,
            workspace_id=workspace_id,
            min_role="viewer",
        )
    automations = await automation_service.list_automations(
        session,
        workspace_ids=allowed_workspace_ids,
        workspace_id=workspace_id,
    )
    return [AutomationRead.model_validate(item) for item in automations]


@router.post("", response_model=AutomationRead)
async def create_automation(
    payload: AutomationCreateRequest,
    context: AuthContext = Depends(require_auth_context),
    session: AsyncSession = Depends(get_session),
) -> AutomationRead:
    await auth_service.assert_workspace_access(
        session,
        user_id=context.user.id,
        workspace_id=payload.workspace_id,
        min_role="member",
    )
    try:
        automation = await automation_service.create_automation(session, payload, actor_id=context.user.id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return AutomationRead.model_validate(automation)


@router.get("/{automation_id}", response_model=AutomationDashboardRead)
async def get_automation_dashboard(
    automation_id: UUID,
    context: AuthContext = Depends(require_auth_context),
    session: AsyncSession = Depends(get_session),
) -> AutomationDashboardRead:
    automation = await _get_authorized_automation(session, context, automation_id, min_role="viewer")
    return await automation_service.get_dashboard(session, automation)


@router.patch("/{automation_id}", response_model=AutomationRead)
async def update_automation(
    automation_id: UUID,
    payload: AutomationUpdateRequest,
    context: AuthContext = Depends(require_auth_context),
    session: AsyncSession = Depends(get_session),
) -> AutomationRead:
    automation = await _get_authorized_automation(session, context, automation_id, min_role="member")
    try:
        automation = await automation_service.update_automation(
            session,
            automation,
            payload,
            actor_id=context.user.id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return AutomationRead.model_validate(automation)


@router.get("/{automation_id}/executions", response_model=list[AutomationExecutionRead])
async def list_executions(
    automation_id: UUID,
    limit: int = Query(default=12, ge=1, le=50),
    context: AuthContext = Depends(require_auth_context),
    session: AsyncSession = Depends(get_session),
) -> list[AutomationExecutionRead]:
    automation = await _get_authorized_automation(session, context, automation_id, min_role="viewer")
    executions = await automation_service.list_executions(session, automation.id, limit=limit)
    return [AutomationExecutionRead.model_validate(item) for item in executions]


@router.post("/{automation_id}/run", response_model=AutomationExecutionRead)
async def run_automation(
    automation_id: UUID,
    payload: AutomationRunRequest,
    context: AuthContext = Depends(require_auth_context),
    session: AsyncSession = Depends(get_session),
) -> AutomationExecutionRead:
    automation = await _get_authorized_automation(session, context, automation_id, min_role="member")
    execution = await automation_service.execute_automation(
        session,
        automation,
        trigger=payload.trigger,
        actor_id=context.user.id,
        force=payload.force,
    )
    return AutomationExecutionRead.model_validate(execution)


@router.post("/{automation_id}/approve", response_model=AutomationExecutionRead)
async def approve_automation(
    automation_id: UUID,
    payload: AutomationApprovalRequest,
    context: AuthContext = Depends(require_auth_context),
    session: AsyncSession = Depends(get_session),
) -> AutomationExecutionRead:
    automation = await _get_authorized_automation(session, context, automation_id, min_role="member")
    try:
        execution = await automation_service.approve_pending_automation(
            session,
            automation,
            actor_id=context.user.id,
            decision_note=payload.decision_note,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return AutomationExecutionRead.model_validate(execution)


@router.post("/{automation_id}/reject", response_model=AutomationExecutionRead)
async def reject_automation(
    automation_id: UUID,
    payload: AutomationApprovalRequest,
    context: AuthContext = Depends(require_auth_context),
    session: AsyncSession = Depends(get_session),
) -> AutomationExecutionRead:
    automation = await _get_authorized_automation(session, context, automation_id, min_role="member")
    try:
        execution = await automation_service.reject_pending_automation(
            session,
            automation,
            actor_id=context.user.id,
            decision_note=payload.decision_note,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return AutomationExecutionRead.model_validate(execution)


@router.post("/scheduler/tick", response_model=AutomationSchedulerTickResponse)
async def tick_scheduler(
    context: AuthContext = Depends(require_auth_context),
) -> AutomationSchedulerTickResponse:
    if context.user.role != "owner":
        raise HTTPException(status_code=403, detail="Only owners can trigger scheduler ticks.")
    processed, started = await scheduler.run_tick()
    return AutomationSchedulerTickResponse(
        processed_automations=processed,
        started_executions=started,
    )
