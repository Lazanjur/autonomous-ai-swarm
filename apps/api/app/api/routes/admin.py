from __future__ import annotations

from datetime import timedelta
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.deps import AuthContext, require_auth_context
from app.db.session import get_session
from app.models.entities import AuditLog, Automation, AutomationExecution, UsageEvent, utc_now
from app.schemas.admin import OpsDashboardResponse
from app.services.auth import AuthService
from app.services.ops import ops_telemetry
from app.services.usage import UsageAccountingService

router = APIRouter()
settings = get_settings()
auth_service = AuthService()
usage_service = UsageAccountingService()


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
            "models_configured": bool(settings.alibaba_api_key),
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
