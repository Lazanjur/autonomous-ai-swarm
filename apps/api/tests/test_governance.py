from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.services.governance import (
    GovernanceError,
    enforce_workspace_quota,
    evaluate_shell_command,
    redact_data,
)
from app.services.tools.common import ToolRuntimeBase


def test_redact_data_masks_nested_secrets():
    payload = {
        "password": "Secret123",
        "headers": {"Authorization": "Bearer abc.def.ghi"},
        "body": "api_key=xyz password:topsecret",
    }

    redacted = redact_data(payload)

    assert redacted["password"] == "[REDACTED]"
    assert redacted["headers"]["Authorization"] == "[REDACTED]"
    assert "[REDACTED]" in redacted["body"]


def test_evaluate_shell_command_requires_approval_for_destructive_git():
    verdict = evaluate_shell_command("git reset --hard HEAD~1")

    assert verdict["allowed"] is False
    assert verdict["requires_approval"] is True


@pytest.mark.asyncio
async def test_enforce_workspace_quota_blocks_hard_limit(monkeypatch):
    workspace_id = uuid4()
    workspace = SimpleNamespace(id=workspace_id, metadata_={"enterprise_policy": {"quotas": {"projects": 1, "soft_enforcement": False}}})

    class _QuotaSession:
        async def get(self, _model, requested_id):
            assert requested_id == workspace_id
            return workspace

        async def scalar(self, _query):
            return 1

    with pytest.raises(GovernanceError, match="quota reached"):
        await enforce_workspace_quota(
            _QuotaSession(),
            workspace_id=workspace_id,
            resource_key="projects",
        )


def test_tool_runtime_audit_redacts_request_and_response():
    runtime = ToolRuntimeBase()
    audit, started_at = runtime.start_audit("demo", {"password": "Secret123"})
    final = runtime.finalize_audit(
        audit,
        started_at,
        status="completed",
        response={"token": "abc123"},
        error="Authorization: Bearer hidden",
    )

    assert final["request"]["password"] == "[REDACTED]"
    assert final["response"]["token"] == "[REDACTED]"
    assert "[REDACTED]" in final["error"]
