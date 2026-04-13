from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field


class OpsHealthRead(BaseModel):
    status: str
    models_configured: bool
    database_ok: bool
    rate_limiting_enabled: bool
    provider_budget_enforced: bool


class OpsRequestMetricsRead(BaseModel):
    total_requests: int
    rate_limited_requests: int
    status_breakdown: dict[str, int]
    recent_requests: list[dict]


class OpsUsageSummaryRead(BaseModel):
    total_cost_usd_24h: float
    total_prompt_tokens_24h: int
    total_completion_tokens_24h: int
    by_model: list[dict]
    recent_provider_events: list[dict]


class OpsAutomationSummaryRead(BaseModel):
    active_automations: int
    awaiting_approval: int
    failed_executions_24h: int


class OpsApprovalSummaryRead(BaseModel):
    pending_items: int
    blocked_actions: int
    recent_sensitive_actions: list[dict]


class OpsAuditSummaryRead(BaseModel):
    recent_audits: list[dict]
    recent_alerts: list[dict]


class OpsBudgetSummaryRead(BaseModel):
    cap_usd: float
    current_spend_usd: float
    remaining_usd: float
    utilization: float
    window_started_at: str


class OpsDashboardResponse(BaseModel):
    generated_at: datetime
    scope: dict
    health: OpsHealthRead
    request_metrics: OpsRequestMetricsRead
    provider_usage: OpsUsageSummaryRead
    budget: OpsBudgetSummaryRead
    automations: OpsAutomationSummaryRead
    approvals: OpsApprovalSummaryRead
    audit: OpsAuditSummaryRead


class AdminSearchResultRead(BaseModel):
    kind: Literal["project", "task", "document", "artifact"]
    workspace_id: UUID
    workspace_name: str
    workspace_slug: str
    score: float
    matched_by: list[str]
    highlight: str | None = None
    project_id: UUID | None = None
    project_name: str | None = None
    thread_id: UUID | None = None
    document_id: UUID | None = None
    artifact_id: UUID | None = None
    title: str
    subtitle: str | None = None
    status: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class AdminSearchResponse(BaseModel):
    query: str
    scope: Literal["global", "workspace"]
    workspace_id: UUID | None = None
    workspace_count: int = 0
    total_results: int = 0
    result_counts: dict[str, int]
    results: list[AdminSearchResultRead]


class IntegrationProviderStatusRead(BaseModel):
    key: str
    provider: str
    configured: bool
    live_delivery_supported: bool
    uses_approval_gate: bool
    detail: str


class IntegrationsStatusResponse(BaseModel):
    generated_at: datetime
    capabilities: dict[str, bool]
    providers: list[IntegrationProviderStatusRead]


class EnterpriseWorkspaceRead(BaseModel):
    id: UUID
    organization_id: UUID
    name: str
    slug: str
    description: str | None = None


class EnterpriseSSOProviderRead(BaseModel):
    key: Literal["google", "microsoft", "oidc", "saml"]
    label: str
    configured: bool
    enabled: bool
    preferred: bool
    detail: str


class EnterpriseSSORead(BaseModel):
    enforced: bool
    password_login_allowed: bool
    preferred_provider: str | None = None
    allowed_providers: list[str]
    domain_allowlist: list[str]
    providers: list[EnterpriseSSOProviderRead]


class EnterpriseRoleMatrixRead(BaseModel):
    role: str
    label: str
    rank: int
    capabilities: list[str]


class EnterpriseMemberRead(BaseModel):
    membership_id: UUID
    user_id: UUID
    email: str
    full_name: str
    workspace_role: str
    global_role: str
    status: str
    joined_at: datetime
    last_login_at: datetime | None = None
    session_active: bool
    active_session_count: int


class EnterpriseRBACRead(BaseModel):
    membership_count: int
    pending_memberships: int
    default_role: str
    invite_policy: str
    role_matrix: list[EnterpriseRoleMatrixRead]
    members: list[EnterpriseMemberRead]


class EnterpriseQuotaPolicyRead(BaseModel):
    projects: int
    threads: int
    documents: int
    artifacts: int
    automations: int
    monthly_cost_cap_usd: float
    monthly_token_cap: int
    soft_enforcement: bool
    billing_alert_thresholds: list[float]


class EnterpriseQuotaUsageRead(BaseModel):
    projects: int
    threads: int
    documents: int
    artifacts: int
    automations: int


class EnterpriseQuotaRead(BaseModel):
    policy: EnterpriseQuotaPolicyRead
    usage: EnterpriseQuotaUsageRead
    utilization: dict[str, float]


class EnterpriseBillingDayRead(BaseModel):
    day: str
    cost_usd: float
    prompt_tokens: int
    completion_tokens: int


class EnterpriseBillingModelRead(BaseModel):
    model_name: str
    provider_name: str
    request_count: int
    cost_usd: float
    prompt_tokens: int
    completion_tokens: int


class EnterpriseBillingRead(BaseModel):
    window_started_at: str
    current_cost_usd: float
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    monthly_cost_cap_usd: float
    monthly_token_cap: int
    cost_utilization: float
    token_utilization: float
    alert_thresholds: list[float]
    by_day: list[EnterpriseBillingDayRead]
    top_models: list[EnterpriseBillingModelRead]


class EnterpriseAuditItemRead(BaseModel):
    id: UUID
    created_at: datetime
    action: str
    resource_type: str
    resource_id: str
    actor_id: UUID | None = None
    actor_email: str | None = None
    actor_name: str | None = None
    details: dict


class EnterpriseAuditSummaryRead(BaseModel):
    recent_items: list[EnterpriseAuditItemRead]


class EnterpriseAdminResponse(BaseModel):
    generated_at: datetime
    workspace: EnterpriseWorkspaceRead
    sso: EnterpriseSSORead
    rbac: EnterpriseRBACRead
    quotas: EnterpriseQuotaRead
    billing: EnterpriseBillingRead
    audit: EnterpriseAuditSummaryRead


class EnterprisePolicyPatchRequest(BaseModel):
    sso_enforced: bool | None = None
    password_login_allowed: bool | None = None
    preferred_provider: str | None = None
    allowed_sso_providers: list[str] | None = None
    domain_allowlist: list[str] | None = None
    invite_policy: str | None = None
    default_role: str | None = None
    project_quota: int | None = Field(default=None, ge=0)
    thread_quota: int | None = Field(default=None, ge=0)
    document_quota: int | None = Field(default=None, ge=0)
    artifact_quota: int | None = Field(default=None, ge=0)
    automation_quota: int | None = Field(default=None, ge=0)
    monthly_cost_cap_usd: float | None = Field(default=None, ge=0)
    monthly_token_cap: int | None = Field(default=None, ge=0)
    soft_enforcement: bool | None = None
    billing_alert_thresholds: list[float] | None = None


class EnterpriseMembershipUpdateRequest(BaseModel):
    role: Literal["viewer", "member", "admin", "owner"] | None = None
    status: Literal["active", "pending", "disabled"] | None = None


class EnterpriseAuditBrowseResponse(BaseModel):
    generated_at: datetime
    workspace_id: UUID
    filters: dict
    action_counts: dict[str, int]
    resource_counts: dict[str, int]
    items: list[EnterpriseAuditItemRead]
