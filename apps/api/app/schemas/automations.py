from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.common import ReadModel


class AutomationDefinition(BaseModel):
    prompt: str
    template_key: str | None = None
    target_thread_id: UUID | None = None
    timezone: str = "UTC"
    use_retrieval: bool = True
    requires_approval: bool = False
    retry_limit: int = Field(default=2, ge=0, le=5)
    timeout_seconds: int = Field(default=900, ge=60, le=7200)
    notify_channels: list[str] = Field(default_factory=list)
    notify_on: list[str] = Field(default_factory=lambda: ["failed"])
    steps: list[str] = Field(default_factory=list)


class AutomationCreateRequest(BaseModel):
    workspace_id: UUID
    name: str
    description: str
    schedule: str
    prompt: str
    template_key: str | None = Field(default=None, max_length=120)
    timezone: str = "UTC"
    use_retrieval: bool = True
    requires_approval: bool = False
    retry_limit: int = Field(default=2, ge=0, le=5)
    timeout_seconds: int = Field(default=900, ge=60, le=7200)
    notify_channels: list[str] = Field(default_factory=list)
    notify_on: list[str] = Field(default_factory=lambda: ["failed"])
    steps: list[str] = Field(default_factory=list)


class AutomationUpdateRequest(BaseModel):
    name: str | None = None
    description: str | None = None
    schedule: str | None = None
    prompt: str | None = None
    template_key: str | None = Field(default=None, max_length=120)
    timezone: str | None = None
    status: str | None = None
    use_retrieval: bool | None = None
    requires_approval: bool | None = None
    retry_limit: int | None = Field(default=None, ge=0, le=5)
    timeout_seconds: int | None = Field(default=None, ge=60, le=7200)
    notify_channels: list[str] | None = None
    notify_on: list[str] | None = None
    steps: list[str] | None = None


class AutomationRunRequest(BaseModel):
    trigger: str = "manual"
    force: bool = False


class AutomationApprovalRequest(BaseModel):
    decision_note: str | None = None


class AutomationRuntimeEventRead(BaseModel):
    timestamp: datetime
    type: str
    level: str = "info"
    message: str
    data: dict = Field(default_factory=dict)


class AutomationNotificationRead(BaseModel):
    channel: str
    target: str | None = None
    event: str
    status: str
    storage_key: str | None = None
    response_status: int | None = None
    detail: str | None = None
    timestamp: datetime


class AutomationRetryStateRead(BaseModel):
    retry_limit: int
    attempts_used: int
    attempts_remaining: int
    retryable: bool
    next_retry_at: datetime | None = None
    backoff_seconds: int | None = None
    last_error: str | None = None


class AutomationApprovalStateRead(BaseModel):
    required: bool = False
    state: str = "not_required"
    requested_at: datetime | None = None
    decided_at: datetime | None = None
    trigger: str | None = None
    decision_note: str | None = None
    decision_by: str | None = None


class AutomationRuntimeSummaryRead(BaseModel):
    queue_status: str
    scheduler_enabled: bool
    poll_interval_seconds: int
    active_execution_count: int
    awaiting_approval_count: int
    retry_scheduled_count: int
    completed_executions_24h: int
    failed_executions_24h: int
    latest_event: AutomationRuntimeEventRead | None = None
    latest_notification: AutomationNotificationRead | None = None
    retry_state: AutomationRetryStateRead | None = None
    approval: AutomationApprovalStateRead | None = None


class AutomationExecutionRead(ReadModel):
    id: UUID
    automation_id: UUID
    workspace_id: UUID
    run_id: UUID | None
    thread_id: UUID | None
    status: str
    trigger: str
    attempt: int
    started_at: datetime | None
    completed_at: datetime | None
    error_message: str | None
    result_summary: str | None
    metadata: dict
    created_at: datetime


class AutomationRead(ReadModel):
    id: UUID
    workspace_id: UUID
    name: str
    description: str
    schedule: str
    status: str
    definition: dict
    last_run_at: datetime | None
    next_run_at: datetime | None
    created_at: datetime


class AutomationDashboardRead(BaseModel):
    automation: AutomationRead
    recent_executions: list[AutomationExecutionRead]
    schedule_summary: str
    pending_approval: bool
    runtime: AutomationRuntimeSummaryRead


class AutomationSchedulerTickResponse(BaseModel):
    processed_automations: int
    started_executions: int
