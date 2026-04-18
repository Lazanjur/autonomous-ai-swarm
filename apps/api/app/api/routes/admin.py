from __future__ import annotations

from datetime import timedelta
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.deps import AuthContext, require_auth_context
from app.db.session import get_session
from app.models.entities import AuditLog, Automation, AutomationExecution, UsageEvent, Workspace, WorkspaceMembership, utc_now
from app.schemas.admin import (
    AdminSearchResponse,
    EnterpriseAdminResponse,
    EnterpriseAuditBrowseResponse,
    EnterpriseMembershipUpdateRequest,
    EnterprisePolicyPatchRequest,
    IntegrationsStatusResponse,
    OpsDashboardResponse,
)
from app.services.auth import AuthService
from app.services.admin_enterprise import AdminEnterpriseService
from app.services.admin_search import AdminSearchService
from app.services.ops import ops_telemetry
from app.services.tools.integrations import ExternalIntegrationTool
from app.services.usage import UsageAccountingService

router = APIRouter()
settings = get_settings()
auth_service = AuthService()
usage_service = UsageAccountingService()
admin_search_service = AdminSearchService()
admin_enterprise_service = AdminEnterpriseService()
integration_tool = ExternalIntegrationTool()


@router.get("/ops", response_model=OpsDashboardResponse)
async def ops_dashboard(
    workspace_id: UUID | None = Query(default=None),
    context: AuthContext = Depends(require_auth_context),
    session: AsyncSession = Depends(get_session),
) -> OpsDashboardResponse:
    if workspace_id is not None:
        await auth_service.assert_workspace_access(
            session,
            user_id=context.user.id,
            workspace_id=workspace_id,
            min_role="admin",
        )
    elif context.user.role != "owner":
        raise HTTPException(status_code=403, detail="Owner access is required for global ops visibility.")

    scope = {"workspace_id": str(workspace_id) if workspace_id else None}
    telemetry = ops_telemetry.snapshot()
    budget = await usage_service.budget_snapshot(scope)

    database_ok = True
    try:
        await session.execute(select(UsageEvent.id).limit(1))
    except Exception:
        database_ok = False

    usage_filters = [UsageEvent.created_at >= utc_now() - timedelta(hours=24)]
    automation_filters = []
    execution_filters = [AutomationExecution.created_at >= utc_now() - timedelta(hours=24)]
    audit_filters = []
    if workspace_id is not None:
        usage_filters.append(UsageEvent.workspace_id == workspace_id)
        automation_filters.append(Automation.workspace_id == workspace_id)
        execution_filters.append(AutomationExecution.workspace_id == workspace_id)
        audit_filters.append(AuditLog.workspace_id == workspace_id)

    usage_totals_row = (
        await session.execute(
            select(
                func.coalesce(func.sum(UsageEvent.estimated_cost), 0.0),
                func.coalesce(func.sum(UsageEvent.prompt_tokens), 0),
                func.coalesce(func.sum(UsageEvent.completion_tokens), 0),
            ).where(*usage_filters)
        )
    ).one()
    usage_by_model_rows = (
        await session.execute(
            select(
                UsageEvent.model_name,
                UsageEvent.provider_name,
                func.count(UsageEvent.id),
                func.coalesce(func.sum(UsageEvent.prompt_tokens), 0),
                func.coalesce(func.sum(UsageEvent.completion_tokens), 0),
                func.coalesce(func.sum(UsageEvent.estimated_cost), 0.0),
            )
            .where(*usage_filters)
            .group_by(UsageEvent.model_name, UsageEvent.provider_name)
            .order_by(desc(func.coalesce(func.sum(UsageEvent.estimated_cost), 0.0)))
        )
    ).all()

    active_automations = int(
        (
            await session.execute(
                select(func.count(Automation.id)).where(Automation.status == "active", *automation_filters)
            )
        ).scalar_one()
        or 0
    )
    awaiting_approval = int(
        (
            await session.execute(
                select(func.count(Automation.id)).where(
                    Automation.status == "awaiting_approval",
                    *automation_filters,
                )
            )
        ).scalar_one()
        or 0
    )
    failed_executions = int(
        (
            await session.execute(
                select(func.count(AutomationExecution.id)).where(
                    AutomationExecution.status == "failed",
                    *execution_filters,
                )
            )
        ).scalar_one()
        or 0
    )

    audits = list(
        (
            await session.execute(
                select(AuditLog)
                .where(*audit_filters)
                .order_by(desc(AuditLog.created_at))
                .limit(15)
            )
        ).scalars()
    )

    blocked_actions = sum(
        1 for event in telemetry["recent_sensitive_actions"] if event.get("outcome") == "blocked"
    )

    return OpsDashboardResponse(
        generated_at=utc_now(),
        scope=scope,
        health={
            "status": "ok" if database_ok else "degraded",
            "models_configured": settings.llm_models_configured,
            "configured_providers": settings.configured_llm_providers,
            "database_ok": database_ok,
            "rate_limiting_enabled": settings.rate_limit_enabled,
            "provider_budget_enforced": settings.provider_budget_enforced,
        },
        request_metrics={
            "total_requests": int(telemetry["request_counts"].get("total", 0)),
            "rate_limited_requests": int(telemetry["request_counts"].get("rate_limited", 0)),
            "status_breakdown": telemetry["status_counts"],
            "recent_requests": telemetry["recent_requests"],
        },
        provider_usage={
            "total_cost_usd_24h": round(float(usage_totals_row[0] or 0.0), 6),
            "total_prompt_tokens_24h": int(usage_totals_row[1] or 0),
            "total_completion_tokens_24h": int(usage_totals_row[2] or 0),
            "by_model": [
                {
                    "model_name": row[0],
                    "provider_name": row[1],
                    "request_count": int(row[2] or 0),
                    "prompt_tokens": int(row[3] or 0),
                    "completion_tokens": int(row[4] or 0),
                    "estimated_cost": round(float(row[5] or 0.0), 6),
                }
                for row in usage_by_model_rows
            ],
            "recent_provider_events": telemetry["recent_provider_events"],
        },
        budget=budget,
        automations={
            "active_automations": active_automations,
            "awaiting_approval": awaiting_approval,
            "failed_executions_24h": failed_executions,
        },
        approvals={
            "pending_items": awaiting_approval,
            "blocked_actions": blocked_actions,
            "recent_sensitive_actions": telemetry["recent_sensitive_actions"],
        },
        audit={
            "recent_audits": [
                {
                    "id": str(item.id),
                    "created_at": item.created_at.isoformat(),
                    "action": item.action,
                    "resource_type": item.resource_type,
                    "resource_id": item.resource_id,
                    "details": item.details,
                }
                for item in audits
            ],
            "recent_alerts": telemetry["recent_alerts"],
        },
    )


@router.get("/search", response_model=AdminSearchResponse)
async def admin_search(
    q: str = Query(..., min_length=1, max_length=240),
    workspace_id: UUID | None = Query(default=None),
    limit: int = Query(default=40, ge=1, le=100),
    context: AuthContext = Depends(require_auth_context),
    session: AsyncSession = Depends(get_session),
) -> AdminSearchResponse:
    accessible_workspaces = await auth_service.list_workspace_access(session, context.user.id)
    accessible_map = {workspace.workspace_id: workspace for workspace in accessible_workspaces}

    if workspace_id is not None:
        if context.user.role != "owner":
            await auth_service.assert_workspace_access(
                session,
                user_id=context.user.id,
                workspace_id=workspace_id,
                min_role="admin",
            )
        elif workspace_id not in accessible_map:
            raise HTTPException(status_code=403, detail="Workspace access denied.")
    elif context.user.role != "owner":
        raise HTTPException(status_code=403, detail="Owner access is required for global admin search.")

    scope_workspace_id = workspace_id if workspace_id in accessible_map else None
    payload = await admin_search_service.search(
        session,
        query=q,
        accessible_workspaces=accessible_workspaces,
        workspace_id=scope_workspace_id,
        limit=limit,
    )
    return AdminSearchResponse(**payload)


@router.get("/enterprise", response_model=EnterpriseAdminResponse)
async def enterprise_admin(
    workspace_id: UUID = Query(...),
    context: AuthContext = Depends(require_auth_context),
    session: AsyncSession = Depends(get_session),
) -> EnterpriseAdminResponse:
    await auth_service.assert_workspace_access(
        session,
        user_id=context.user.id,
        workspace_id=workspace_id,
        min_role="admin",
    )
    payload = await admin_enterprise_service.enterprise_snapshot(
        session,
        workspace_id=workspace_id,
    )
    return EnterpriseAdminResponse(**payload)


@router.patch("/enterprise/policies", response_model=EnterpriseAdminResponse)
async def update_enterprise_policies(
    payload: EnterprisePolicyPatchRequest,
    workspace_id: UUID = Query(...),
    context: AuthContext = Depends(require_auth_context),
    session: AsyncSession = Depends(get_session),
) -> EnterpriseAdminResponse:
    membership = await auth_service.assert_workspace_access(
        session,
        user_id=context.user.id,
        workspace_id=workspace_id,
        min_role="admin",
    )
    workspace = await session.get(Workspace, workspace_id)
    if workspace is None:
        raise HTTPException(status_code=404, detail="Workspace not found.")

    patch: dict[str, object] = {}
    sso_patch: dict[str, object] = {}
    rbac_patch: dict[str, object] = {}
    quotas_patch: dict[str, object] = {}

    if payload.sso_enforced is not None:
        sso_patch["enforced"] = payload.sso_enforced
    if payload.password_login_allowed is not None:
        sso_patch["password_login_allowed"] = payload.password_login_allowed
    if payload.preferred_provider is not None:
        sso_patch["preferred_provider"] = payload.preferred_provider
    if payload.allowed_sso_providers is not None:
        sso_patch["allowed_providers"] = payload.allowed_sso_providers
    if payload.domain_allowlist is not None:
        sso_patch["domain_allowlist"] = payload.domain_allowlist

    if payload.invite_policy is not None:
        rbac_patch["invite_policy"] = payload.invite_policy
    if payload.default_role is not None:
        rbac_patch["default_role"] = payload.default_role

    quota_map = {
        "projects": payload.project_quota,
        "threads": payload.thread_quota,
        "documents": payload.document_quota,
        "artifacts": payload.artifact_quota,
        "automations": payload.automation_quota,
        "monthly_cost_cap_usd": payload.monthly_cost_cap_usd,
        "monthly_token_cap": payload.monthly_token_cap,
        "soft_enforcement": payload.soft_enforcement,
        "billing_alert_thresholds": payload.billing_alert_thresholds,
    }
    quotas_patch.update({key: value for key, value in quota_map.items() if value is not None})

    if sso_patch:
        patch["sso"] = sso_patch
    if rbac_patch:
        patch["rbac"] = rbac_patch
    if quotas_patch:
        patch["quotas"] = quotas_patch

    normalized_policy = await admin_enterprise_service.update_policy(
        session,
        workspace=workspace,
        patch=patch,
    )
    session.add(
        AuditLog(
            actor_id=context.user.id,
            workspace_id=workspace_id,
            action="workspace.enterprise_policy.updated",
            resource_type="workspace",
            resource_id=str(workspace_id),
            details={
                "actor_role": membership.role,
                "patch": patch,
                "normalized_policy": normalized_policy,
            },
        )
    )
    await session.commit()
    snapshot = await admin_enterprise_service.enterprise_snapshot(session, workspace_id=workspace_id)
    return EnterpriseAdminResponse(**snapshot)


@router.patch("/memberships/{membership_id}", response_model=EnterpriseAdminResponse)
async def update_workspace_membership(
    membership_id: UUID,
    payload: EnterpriseMembershipUpdateRequest,
    workspace_id: UUID = Query(...),
    context: AuthContext = Depends(require_auth_context),
    session: AsyncSession = Depends(get_session),
) -> EnterpriseAdminResponse:
    actor_membership = await auth_service.assert_workspace_access(
        session,
        user_id=context.user.id,
        workspace_id=workspace_id,
        min_role="admin",
    )
    result = await session.execute(
        select(WorkspaceMembership).where(
            WorkspaceMembership.id == membership_id,
            WorkspaceMembership.workspace_id == workspace_id,
        )
    )
    membership = result.scalar_one_or_none()
    if membership is None:
        raise HTTPException(status_code=404, detail="Workspace membership not found.")
    if membership.user_id == context.user.id:
        raise HTTPException(status_code=400, detail="Use a separate session to change your own workspace role.")
    if actor_membership.role != "owner" and (
        membership.role == "owner" or payload.role == "owner"
    ):
        raise HTTPException(status_code=403, detail="Only owners can manage owner memberships.")

    changed: dict[str, object] = {}
    if payload.role is not None and payload.role != membership.role:
        changed["role"] = {"from": membership.role, "to": payload.role}
        membership.role = payload.role
    if payload.status is not None and payload.status != membership.status:
        changed["status"] = {"from": membership.status, "to": payload.status}
        membership.status = payload.status
    if not changed:
        raise HTTPException(status_code=400, detail="No membership changes were provided.")

    session.add(
        AuditLog(
            actor_id=context.user.id,
            workspace_id=workspace_id,
            action="workspace.membership.updated",
            resource_type="workspace_membership",
            resource_id=str(membership.id),
            details={
                "workspace_role": actor_membership.role,
                "changed": changed,
                "target_user_id": str(membership.user_id),
            },
        )
    )
    await session.commit()
    snapshot = await admin_enterprise_service.enterprise_snapshot(session, workspace_id=workspace_id)
    return EnterpriseAdminResponse(**snapshot)


@router.get("/audit", response_model=EnterpriseAuditBrowseResponse)
async def browse_workspace_audit(
    workspace_id: UUID = Query(...),
    action: str | None = Query(default=None, min_length=1, max_length=255),
    resource_type: str | None = Query(default=None, min_length=1, max_length=128),
    actor_id: UUID | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    context: AuthContext = Depends(require_auth_context),
    session: AsyncSession = Depends(get_session),
) -> EnterpriseAuditBrowseResponse:
    await auth_service.assert_workspace_access(
        session,
        user_id=context.user.id,
        workspace_id=workspace_id,
        min_role="admin",
    )
    payload = await admin_enterprise_service.browse_audit(
        session,
        workspace_id=workspace_id,
        action=action,
        resource_type=resource_type,
        actor_id=actor_id,
        limit=limit,
    )
    return EnterpriseAuditBrowseResponse(**payload)


@router.get("/integrations", response_model=IntegrationsStatusResponse)
async def integrations_status(
    workspace_id: UUID | None = Query(default=None),
    context: AuthContext = Depends(require_auth_context),
    session: AsyncSession = Depends(get_session),
) -> IntegrationsStatusResponse:
    if workspace_id is not None:
        await auth_service.assert_workspace_access(
            session,
            user_id=context.user.id,
            workspace_id=workspace_id,
            min_role="admin",
        )
    elif context.user.role != "owner":
        raise HTTPException(status_code=403, detail="Owner access is required for global integration visibility.")

    status_payload = await integration_tool.integration_status()
    return IntegrationsStatusResponse(
        generated_at=utc_now(),
        capabilities=status_payload.get("capabilities", {}),
        providers=status_payload.get("providers", []),
    )
