from __future__ import annotations

from copy import deepcopy
from datetime import timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models.entities import (
    Artifact,
    AuditLog,
    Automation,
    ChatThread,
    Document,
    Project,
    UsageEvent,
    User,
    UserSession,
    Workspace,
    WorkspaceMembership,
    utc_now,
)

settings = get_settings()

ROLE_MATRIX: list[dict[str, Any]] = [
    {
        "role": "viewer",
        "label": "Viewer",
        "rank": 10,
        "capabilities": [
            "View workspace state",
            "Read chat history and artifacts",
            "Inspect admin dashboards when granted",
        ],
    },
    {
        "role": "member",
        "label": "Member",
        "rank": 20,
        "capabilities": [
            "Run tasks and create threads",
            "Upload knowledge and generate artifacts",
            "Create automations inside allowed quotas",
        ],
    },
    {
        "role": "admin",
        "label": "Admin",
        "rank": 30,
        "capabilities": [
            "Manage workspace policies and quotas",
            "Approve sensitive actions and monitor billing",
            "Manage non-owner members and audit visibility",
        ],
    },
    {
        "role": "owner",
        "label": "Owner",
        "rank": 40,
        "capabilities": [
            "Full workspace governance",
            "Manage owner-level roles and SSO posture",
            "Cross-workspace and organization oversight",
        ],
    },
]

DEFAULT_ENTERPRISE_POLICY: dict[str, Any] = {
    "sso": {
        "enforced": False,
        "password_login_allowed": True,
        "preferred_provider": None,
        "allowed_providers": ["google", "microsoft", "oidc", "saml"],
        "domain_allowlist": [],
    },
    "rbac": {
        "default_role": "member",
        "invite_policy": "admin_only",
    },
    "quotas": {
        "projects": 50,
        "threads": 500,
        "documents": 1000,
        "artifacts": 2500,
        "automations": 200,
        "monthly_cost_cap_usd": 2500.0,
        "monthly_token_cap": 20_000_000,
        "soft_enforcement": True,
        "billing_alert_thresholds": [0.5, 0.8, 1.0],
    },
}


class AdminEnterpriseService:
    async def enterprise_snapshot(
        self,
        session: AsyncSession,
        *,
        workspace_id: UUID,
    ) -> dict[str, Any]:
        workspace = await session.get(Workspace, workspace_id)
        if workspace is None:
            raise ValueError("Workspace not found.")

        policy = self.normalize_policy(workspace.metadata_)
        memberships = await self._membership_payload(session, workspace_id=workspace_id)
        quotas = await self._quota_payload(
            session,
            workspace_id=workspace_id,
            quota_policy=policy["quotas"],
        )
        billing = await self._billing_payload(
            session,
            workspace_id=workspace_id,
            quota_policy=policy["quotas"],
        )
        audit_summary = await self._audit_summary(session, workspace_id=workspace_id)

        return {
            "generated_at": utc_now(),
            "workspace": {
                "id": workspace.id,
                "organization_id": workspace.organization_id,
                "name": workspace.name,
                "slug": workspace.slug,
                "description": workspace.description,
            },
            "sso": {
                **policy["sso"],
                "providers": self._sso_provider_payload(policy["sso"]),
            },
            "rbac": {
                "membership_count": len(memberships),
                "pending_memberships": sum(1 for item in memberships if item["status"] != "active"),
                "default_role": policy["rbac"]["default_role"],
                "invite_policy": policy["rbac"]["invite_policy"],
                "role_matrix": deepcopy(ROLE_MATRIX),
                "members": memberships,
            },
            "quotas": quotas,
            "billing": billing,
            "audit": audit_summary,
        }

    def normalize_policy(self, workspace_metadata: dict[str, Any] | None) -> dict[str, Any]:
        metadata = workspace_metadata if isinstance(workspace_metadata, dict) else {}
        raw_policy = metadata.get("enterprise_policy")
        policy = deepcopy(DEFAULT_ENTERPRISE_POLICY)
        if isinstance(raw_policy, dict):
            self._deep_merge(policy, raw_policy)

        sso = policy["sso"]
        sso["allowed_providers"] = [
            provider
            for provider in [str(item).strip().lower() for item in sso.get("allowed_providers", [])]
            if provider in {"google", "microsoft", "oidc", "saml"}
        ] or deepcopy(DEFAULT_ENTERPRISE_POLICY["sso"]["allowed_providers"])
        sso["domain_allowlist"] = [
            str(item).strip().lower()
            for item in sso.get("domain_allowlist", [])
            if str(item).strip()
        ]
        if sso.get("preferred_provider") not in {"google", "microsoft", "oidc", "saml"}:
            sso["preferred_provider"] = None

        rbac = policy["rbac"]
        if rbac.get("default_role") not in {"viewer", "member", "admin"}:
            rbac["default_role"] = "member"
        if rbac.get("invite_policy") not in {"owner_only", "admin_only", "member_self_serve"}:
            rbac["invite_policy"] = "admin_only"

        quotas = policy["quotas"]
        for key, fallback in DEFAULT_ENTERPRISE_POLICY["quotas"].items():
            if key == "billing_alert_thresholds":
                continue
            value = quotas.get(key)
            if isinstance(fallback, float):
                try:
                    quotas[key] = max(float(value), 0.0)
                except (TypeError, ValueError):
                    quotas[key] = fallback
            elif isinstance(fallback, bool):
                quotas[key] = bool(value)
            else:
                try:
                    quotas[key] = max(int(value), 0)
                except (TypeError, ValueError):
                    quotas[key] = fallback

        thresholds = quotas.get("billing_alert_thresholds")
        normalized_thresholds: list[float] = []
        if isinstance(thresholds, list):
            for item in thresholds:
                try:
                    parsed = float(item)
                except (TypeError, ValueError):
                    continue
                if 0 < parsed <= 2:
                    normalized_thresholds.append(round(parsed, 2))
        quotas["billing_alert_thresholds"] = normalized_thresholds or deepcopy(
            DEFAULT_ENTERPRISE_POLICY["quotas"]["billing_alert_thresholds"]
        )
        quotas["billing_alert_thresholds"] = sorted(set(quotas["billing_alert_thresholds"]))
        return policy

    async def update_policy(
        self,
        session: AsyncSession,
        *,
        workspace: Workspace,
        patch: dict[str, Any],
    ) -> dict[str, Any]:
        current_policy = self.normalize_policy(workspace.metadata_)
        self._deep_merge(current_policy, patch)
        normalized = self.normalize_policy({"enterprise_policy": current_policy})
        metadata = dict(workspace.metadata_ or {})
        metadata["enterprise_policy"] = normalized
        workspace.metadata_ = metadata
        await session.flush()
        return normalized

    async def browse_audit(
        self,
        session: AsyncSession,
        *,
        workspace_id: UUID,
        limit: int = 50,
        action: str | None = None,
        resource_type: str | None = None,
        actor_id: UUID | None = None,
    ) -> dict[str, Any]:
        filters = [AuditLog.workspace_id == workspace_id]
        if action:
            filters.append(AuditLog.action == action)
        if resource_type:
            filters.append(AuditLog.resource_type == resource_type)
        if actor_id:
            filters.append(AuditLog.actor_id == actor_id)

        logs = list(
            (
                await session.execute(
                    select(AuditLog, User)
                    .outerjoin(User, User.id == AuditLog.actor_id)
                    .where(*filters)
                    .order_by(desc(AuditLog.created_at))
                    .limit(limit)
                )
            ).all()
        )
        action_counts = (
            await session.execute(
                select(AuditLog.action, func.count(AuditLog.id))
                .where(AuditLog.workspace_id == workspace_id)
                .group_by(AuditLog.action)
                .order_by(desc(func.count(AuditLog.id)))
                .limit(10)
            )
        ).all()
        resource_counts = (
            await session.execute(
                select(AuditLog.resource_type, func.count(AuditLog.id))
                .where(AuditLog.workspace_id == workspace_id)
                .group_by(AuditLog.resource_type)
                .order_by(desc(func.count(AuditLog.id)))
                .limit(10)
            )
        ).all()

        return {
            "generated_at": utc_now(),
            "workspace_id": workspace_id,
            "filters": {
                "action": action,
                "resource_type": resource_type,
                "actor_id": str(actor_id) if actor_id else None,
                "limit": limit,
            },
            "action_counts": {str(row[0]): int(row[1] or 0) for row in action_counts if row[0]},
            "resource_counts": {str(row[0]): int(row[1] or 0) for row in resource_counts if row[0]},
            "items": [
                {
                    "id": item.id,
                    "created_at": item.created_at,
                    "action": item.action,
                    "resource_type": item.resource_type,
                    "resource_id": item.resource_id,
                    "actor_id": item.actor_id,
                    "actor_email": actor.email if actor else None,
                    "actor_name": actor.full_name if actor else None,
                    "details": item.details,
                }
                for item, actor in logs
            ],
        }

    async def _membership_payload(
        self,
        session: AsyncSession,
        *,
        workspace_id: UUID,
    ) -> list[dict[str, Any]]:
        now = utc_now()
        session_rows = (
            await session.execute(
                select(UserSession.user_id, func.count(UserSession.id))
                .where(UserSession.revoked_at.is_(None), UserSession.expires_at > now)
                .group_by(UserSession.user_id)
            )
        ).all()
        active_session_map = {row[0]: int(row[1] or 0) for row in session_rows}
        rows = (
            await session.execute(
                select(WorkspaceMembership, User)
                .join(User, User.id == WorkspaceMembership.user_id)
                .where(WorkspaceMembership.workspace_id == workspace_id)
                .order_by(desc(WorkspaceMembership.created_at))
            )
        ).all()
        payload = []
        for membership, user in rows:
            payload.append(
                {
                    "membership_id": membership.id,
                    "user_id": user.id,
                    "email": user.email,
                    "full_name": user.full_name,
                    "workspace_role": membership.role,
                    "global_role": user.role,
                    "status": membership.status,
                    "joined_at": membership.created_at,
                    "last_login_at": user.last_login_at,
                    "session_active": bool(active_session_map.get(user.id, 0)),
                    "active_session_count": active_session_map.get(user.id, 0),
                }
            )
        return payload

    async def _quota_payload(
        self,
        session: AsyncSession,
        *,
        workspace_id: UUID,
        quota_policy: dict[str, Any],
    ) -> dict[str, Any]:
        counts = {
            "projects": int((await session.execute(select(func.count(Project.id)).where(Project.workspace_id == workspace_id))).scalar_one() or 0),
            "threads": int((await session.execute(select(func.count(ChatThread.id)).where(ChatThread.workspace_id == workspace_id))).scalar_one() or 0),
            "documents": int((await session.execute(select(func.count(Document.id)).where(Document.workspace_id == workspace_id))).scalar_one() or 0),
            "artifacts": int((await session.execute(select(func.count(Artifact.id)).where(Artifact.workspace_id == workspace_id))).scalar_one() or 0),
            "automations": int((await session.execute(select(func.count(Automation.id)).where(Automation.workspace_id == workspace_id))).scalar_one() or 0),
        }
        utilization = {}
        for key in ("projects", "threads", "documents", "artifacts", "automations"):
            limit_value = int(quota_policy.get(key) or 0)
            utilization[key] = round(counts[key] / limit_value, 4) if limit_value > 0 else 0.0
        return {
            "policy": quota_policy,
            "usage": counts,
            "utilization": utilization,
        }

    async def _billing_payload(
        self,
        session: AsyncSession,
        *,
        workspace_id: UUID,
        quota_policy: dict[str, Any],
    ) -> dict[str, Any]:
        window_started_at = utc_now() - timedelta(days=30)
        usage_filters = [
            UsageEvent.workspace_id == workspace_id,
            UsageEvent.created_at >= window_started_at,
        ]
        totals = (
            await session.execute(
                select(
                    func.coalesce(func.sum(UsageEvent.estimated_cost), 0.0),
                    func.coalesce(func.sum(UsageEvent.prompt_tokens), 0),
                    func.coalesce(func.sum(UsageEvent.completion_tokens), 0),
                ).where(*usage_filters)
            )
        ).one()
        by_day_rows = (
            await session.execute(
                select(
                    func.date(UsageEvent.created_at),
                    func.coalesce(func.sum(UsageEvent.estimated_cost), 0.0),
                    func.coalesce(func.sum(UsageEvent.prompt_tokens), 0),
                    func.coalesce(func.sum(UsageEvent.completion_tokens), 0),
                )
                .where(*usage_filters)
                .group_by(func.date(UsageEvent.created_at))
                .order_by(func.date(UsageEvent.created_at))
            )
        ).all()
        top_models = (
            await session.execute(
                select(
                    UsageEvent.model_name,
                    UsageEvent.provider_name,
                    func.count(UsageEvent.id),
                    func.coalesce(func.sum(UsageEvent.estimated_cost), 0.0),
                    func.coalesce(func.sum(UsageEvent.prompt_tokens), 0),
                    func.coalesce(func.sum(UsageEvent.completion_tokens), 0),
                )
                .where(*usage_filters)
                .group_by(UsageEvent.model_name, UsageEvent.provider_name)
                .order_by(desc(func.coalesce(func.sum(UsageEvent.estimated_cost), 0.0)))
                .limit(8)
            )
        ).all()
        total_prompt_tokens = int(totals[1] or 0)
        total_completion_tokens = int(totals[2] or 0)
        total_tokens = total_prompt_tokens + total_completion_tokens
        monthly_cost_cap = float(quota_policy.get("monthly_cost_cap_usd") or 0.0)
        monthly_token_cap = int(quota_policy.get("monthly_token_cap") or 0)
        return {
            "window_started_at": window_started_at.isoformat(),
            "current_cost_usd": round(float(totals[0] or 0.0), 6),
            "prompt_tokens": total_prompt_tokens,
            "completion_tokens": total_completion_tokens,
            "total_tokens": total_tokens,
            "monthly_cost_cap_usd": monthly_cost_cap,
            "monthly_token_cap": monthly_token_cap,
            "cost_utilization": round(float(totals[0] or 0.0) / monthly_cost_cap, 4)
            if monthly_cost_cap > 0
            else 0.0,
            "token_utilization": round(total_tokens / monthly_token_cap, 4)
            if monthly_token_cap > 0
            else 0.0,
            "alert_thresholds": quota_policy.get("billing_alert_thresholds", []),
            "by_day": [
                {
                    "day": str(row[0]),
                    "cost_usd": round(float(row[1] or 0.0), 6),
                    "prompt_tokens": int(row[2] or 0),
                    "completion_tokens": int(row[3] or 0),
                }
                for row in by_day_rows
            ],
            "top_models": [
                {
                    "model_name": str(row[0]),
                    "provider_name": str(row[1]),
                    "request_count": int(row[2] or 0),
                    "cost_usd": round(float(row[3] or 0.0), 6),
                    "prompt_tokens": int(row[4] or 0),
                    "completion_tokens": int(row[5] or 0),
                }
                for row in top_models
            ],
        }

    async def _audit_summary(
        self,
        session: AsyncSession,
        *,
        workspace_id: UUID,
    ) -> dict[str, Any]:
        recent = list(
            (
                await session.execute(
                    select(AuditLog, User)
                    .outerjoin(User, User.id == AuditLog.actor_id)
                    .where(AuditLog.workspace_id == workspace_id)
                    .order_by(desc(AuditLog.created_at))
                    .limit(10)
                )
            ).all()
        )
        return {
            "recent_items": [
                {
                    "id": item.id,
                    "created_at": item.created_at,
                    "action": item.action,
                    "resource_type": item.resource_type,
                    "resource_id": item.resource_id,
                    "actor_email": actor.email if actor else None,
                    "actor_name": actor.full_name if actor else None,
                    "details": item.details,
                }
                for item, actor in recent
            ]
        }

    def _sso_provider_payload(self, sso_policy: dict[str, Any]) -> list[dict[str, Any]]:
        configured = {
            "google": bool(settings.sso_google_client_id),
            "microsoft": bool(settings.sso_microsoft_client_id),
            "oidc": bool(settings.sso_oidc_client_id and settings.sso_oidc_issuer_url),
            "saml": bool(settings.sso_saml_entity_id and settings.sso_saml_sso_url),
        }
        details = {
            "google": "Google workforce SSO via hosted OAuth/OIDC client.",
            "microsoft": "Microsoft Entra ID SSO posture and tenant-backed sign-in.",
            "oidc": "Generic enterprise OIDC provider support.",
            "saml": "SAML-based workforce sign-in for legacy enterprise identity stacks.",
        }
        providers = []
        allowed = set(sso_policy.get("allowed_providers", []))
        preferred = sso_policy.get("preferred_provider")
        for key, label in (
            ("google", "Google"),
            ("microsoft", "Microsoft"),
            ("oidc", "Generic OIDC"),
            ("saml", "SAML"),
        ):
            providers.append(
                {
                    "key": key,
                    "label": label,
                    "configured": configured[key],
                    "enabled": key in allowed,
                    "preferred": preferred == key,
                    "detail": details[key],
                }
            )
        return providers

    def _deep_merge(self, target: dict[str, Any], source: dict[str, Any]) -> None:
        for key, value in source.items():
            if isinstance(value, dict) and isinstance(target.get(key), dict):
                self._deep_merge(target[key], value)
            else:
                target[key] = value
