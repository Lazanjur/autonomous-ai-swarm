from __future__ import annotations

import re
from typing import Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import Artifact, AuditLog, Automation, ChatThread, Document, Project, Workspace
from app.services.admin_enterprise import AdminEnterpriseService

REDACTED_VALUE = "[REDACTED]"
_SECRET_KEY_PATTERN = re.compile(
    r"(?i)(password|passwd|pwd|secret|token|api[-_]?key|authorization|cookie|session|credential)"
)
_ASSIGNMENT_PATTERN = re.compile(
    r"(?i)\b(password|passwd|pwd|secret|token|api[-_]?key|authorization|cookie|session|credential)\b"
    r"(\s*[:=]\s*|\s+is\s+)([^\s,;]+)"
)
_BEARER_PATTERN = re.compile(r"(?i)\bbearer\s+[a-z0-9._\-]+")
_URL_CREDENTIAL_PATTERN = re.compile(r"(?i)(https?://[^:/\s]+:)([^@/\s]+)(@)")

_DESTRUCTIVE_SHELL_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"(?i)(^|[\s;&|])rm\s+.+-(?:[^\n\r]*\br\b[^\n\r]*\bf\b|[^\n\r]*\bf\b[^\n\r]*\br\b)"),
    re.compile(r"(?i)(^|[\s;&|])remove-item\b[^\n\r]*-(recurse|force)"),
    re.compile(r"(?i)(^|[\s;&|])del\s+/f"),
    re.compile(r"(?i)(^|[\s;&|])rmdir\b[^\n\r]*/s"),
    re.compile(r"(?i)(^|[\s;&|])git\s+reset\s+--hard\b"),
    re.compile(r"(?i)(^|[\s;&|])git\s+clean\b"),
    re.compile(r"(?i)(^|[\s;&|])git\s+checkout\s+--\b"),
    re.compile(r"(?i)(^|[\s;&|])git\s+restore\b[^\n\r]*(--staged|--worktree|--source)"),
    re.compile(r"(?i)(^|[\s;&|])(shutdown|reboot)\b"),
    re.compile(r"(?i)(^|[\s;&|])mkfs\.[a-z0-9]+\b"),
    re.compile(r"(?i)(^|[\s;&|])format\s+[a-z]:"),
    re.compile(r"(?i)(^|[\s;&|])dd\b[^\n\r]+\bof="),
)

_QUOTA_MODEL_MAP: dict[str, Any] = {
    "projects": Project,
    "threads": ChatThread,
    "documents": Document,
    "artifacts": Artifact,
    "automations": Automation,
}


class GovernanceError(ValueError):
    """Base error for runtime governance policies."""


class ApprovalRequiredError(GovernanceError):
    """Raised when a destructive action needs explicit user approval."""


def redact_text(value: str | None) -> str | None:
    if value is None:
        return None
    redacted = _ASSIGNMENT_PATTERN.sub(lambda match: f"{match.group(1)}{match.group(2)}{REDACTED_VALUE}", value)
    redacted = _BEARER_PATTERN.sub("Bearer [REDACTED]", redacted)
    redacted = _URL_CREDENTIAL_PATTERN.sub(r"\1[REDACTED]\3", redacted)
    return redacted


def redact_data(value: Any) -> Any:
    if isinstance(value, dict):
        redacted: dict[str, Any] = {}
        for key, nested in value.items():
            if _SECRET_KEY_PATTERN.search(str(key)):
                redacted[key] = REDACTED_VALUE
            else:
                redacted[key] = redact_data(nested)
        return redacted
    if isinstance(value, list):
        return [redact_data(item) for item in value]
    if isinstance(value, tuple):
        return tuple(redact_data(item) for item in value)
    if isinstance(value, str):
        return redact_text(value)
    return value


def evaluate_shell_command(command: str) -> dict[str, Any]:
    normalized_command = " ".join(command.split()).strip()
    for pattern in _DESTRUCTIVE_SHELL_PATTERNS:
        if pattern.search(normalized_command):
            return {
                "allowed": False,
                "requires_approval": True,
                "reason": (
                    "This shell command includes destructive or rollback-oriented operations and "
                    "requires explicit approval before execution."
                ),
                "command_preview": redact_text(normalized_command[:240]),
            }
    return {
        "allowed": True,
        "requires_approval": False,
        "reason": None,
        "command_preview": redact_text(normalized_command[:240]),
    }


async def get_workspace_quota_snapshot(
    session: AsyncSession,
    *,
    workspace_id: UUID,
    resource_key: str,
) -> dict[str, Any]:
    workspace = await session.get(Workspace, workspace_id)
    if workspace is None:
        raise GovernanceError("Workspace not found.")
    policy = AdminEnterpriseService().normalize_policy(workspace.metadata_)
    quota_policy = policy["quotas"]
    if resource_key not in _QUOTA_MODEL_MAP:
        raise GovernanceError("Unsupported quota resource.")
    model = _QUOTA_MODEL_MAP[resource_key]
    current_count = await session.scalar(
        select(func.count()).select_from(model).where(model.workspace_id == workspace_id)
    )
    return {
        "workspace": workspace,
        "resource_key": resource_key,
        "current_count": int(current_count or 0),
        "limit": int(quota_policy.get(resource_key) or 0),
        "soft_enforcement": bool(quota_policy.get("soft_enforcement", True)),
    }


async def enforce_workspace_quota(
    session: AsyncSession,
    *,
    workspace_id: UUID,
    resource_key: str,
) -> dict[str, Any]:
    snapshot = await get_workspace_quota_snapshot(
        session,
        workspace_id=workspace_id,
        resource_key=resource_key,
    )
    limit = snapshot["limit"]
    if limit > 0 and snapshot["current_count"] >= limit and not snapshot["soft_enforcement"]:
        raise GovernanceError(
            f"Workspace {resource_key} quota reached ({snapshot['current_count']}/{limit})."
        )
    return snapshot


def build_audit_record(
    *,
    actor_id,
    workspace_id,
    action: str,
    resource_type: str,
    resource_id: str,
    details: dict[str, Any] | None = None,
) -> AuditLog:
    return AuditLog(
        actor_id=actor_id,
        workspace_id=workspace_id,
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        details=redact_data(details or {}),
    )
