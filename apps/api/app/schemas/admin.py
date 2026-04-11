from datetime import datetime

from pydantic import BaseModel


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
