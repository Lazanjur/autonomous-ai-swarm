from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.common import ReadModel


class AutomationDefinition(BaseModel):
    prompt: str
    target_thread_id: UUID | None = None
    timezone: str = "UTC"
    use_retrieval: bool = True
    requires_approval: bool = False
    retry_limit: int = Field(default=2, ge=0, le=5)
    timeout_seconds: int = Field(default=900, ge=60, le=7200)
    notify_channels: list[str] = Field(default_factory=list)
    steps: list[str] = Field(default_factory=list)


class AutomationCreateRequest(BaseModel):
    workspace_id: UUID
    name: str
    description: str
    schedule: str
    prompt: str
    timezone: str = "UTC"
    use_retrieval: bool = True
    requires_approval: bool = False
    retry_limit: int = Field(default=2, ge=0, le=5)
    timeout_seconds: int = Field(default=900, ge=60, le=7200)
    notify_channels: list[str] = Field(default_factory=list)
    steps: list[str] = Field(default_factory=list)


class AutomationUpdateRequest(BaseModel):
    name: str | None = None
    description: str | None = None
    schedule: str | None = None
    prompt: str | None = None
    timezone: str | None = None
    status: str | None = None
    use_retrieval: bool | None = None
    requires_approval: bool | None = None
    retry_limit: int | None = Field(default=None, ge=0, le=5)
    timeout_seconds: int | None = Field(default=None, ge=60, le=7200)
    notify_channels: list[str] | None = None
    steps: list[str] | None = None


class AutomationRunRequest(BaseModel):
    trigger: str = "manual"
    force: bool = False


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


class AutomationSchedulerTickResponse(BaseModel):
    processed_automations: int
    started_executions: int
