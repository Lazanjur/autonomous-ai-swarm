from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.common import ReadModel


class ThreadRead(ReadModel):
    id: UUID
    workspace_id: UUID
    project_id: UUID | None = None
    title: str
    status: str
    metadata: dict = Field(default_factory=dict, validation_alias="metadata_")
    created_at: datetime
    updated_at: datetime


class ThreadSummaryRead(ThreadRead):
    message_count: int = 0
    run_count: int = 0
    last_message_preview: str | None = None
    last_activity_at: datetime


class MessageRead(ReadModel):
    id: UUID
    thread_id: UUID
    run_id: UUID | None
    role: str
    content: str
    citations: list[dict] = Field(default_factory=list)
    metadata: dict = Field(default_factory=dict, validation_alias="metadata_")
    created_at: datetime


class RunRead(ReadModel):
    id: UUID
    thread_id: UUID
    workspace_id: UUID
    status: str
    supervisor_model: str
    user_message: str
    final_response: str | None
    summary: str | None
    plan: list[dict]
    created_at: datetime


class RunStepRead(ReadModel):
    id: UUID
    run_id: UUID
    agent_name: str
    step_index: int
    status: str
    confidence: float
    input_payload: dict = Field(default_factory=dict)
    output_payload: dict = Field(default_factory=dict)
    created_at: datetime


class ToolCallRead(ReadModel):
    id: UUID
    run_step_id: UUID
    tool_name: str
    status: str
    input_payload: dict = Field(default_factory=dict)
    output_payload: dict = Field(default_factory=dict)
    created_at: datetime


class ExecutionEnvironmentRequest(BaseModel):
    target_os: Literal["linux", "windows", "macos"] = "linux"
    runtime_profile: Literal["auto", "python", "node", "shell", "powershell"] = "auto"
    resource_tier: Literal["small", "medium", "large", "gpu"] = "small"
    network_access: bool | None = None
    persistence_scope: Literal["task", "workspace"] = "task"


AutonomyMode = Literal["safe", "autonomous", "maximum"]


class ChatRunRequest(BaseModel):
    workspace_id: UUID
    thread_id: UUID | None = None
    project_id: UUID | None = None
    message: str
    mode: str = "autonomous"
    autonomy_mode: AutonomyMode = "autonomous"
    use_retrieval: bool = True
    model_profile: str | None = None
    template_key: str | None = Field(default=None, max_length=120)
    composer_context: dict = Field(default_factory=dict)
    execution_environment: ExecutionEnvironmentRequest | None = None


class ChatRunResponse(BaseModel):
    thread: ThreadRead
    run: RunRead
    messages: list[MessageRead]


class ChatThreadCreateRequest(BaseModel):
    workspace_id: UUID
    project_id: UUID | None = None
    title: str | None = None


class ChatThreadUpdateRequest(BaseModel):
    title: str | None = Field(default=None, max_length=255)
    status: str | None = Field(default=None, max_length=64)
    metadata_updates: dict = Field(default_factory=dict)


class SharedMemoryRead(BaseModel):
    summary: str | None = None
    findings: list[str] = Field(default_factory=list)
    risks: list[str] = Field(default_factory=list)
    open_questions: list[str] = Field(default_factory=list)
    recent_requests: list[str] = Field(default_factory=list)
    recent_summaries: list[str] = Field(default_factory=list)
    focus_areas: list[str] = Field(default_factory=list)
    agent_memory: list[dict] = Field(default_factory=list)
    run_count: int = 0
    last_updated_at: str | None = None
    source_run_id: str | None = None
    source_thread_id: str | None = None


class ChatWorkspaceResponse(BaseModel):
    workspace_id: UUID
    selected_thread_id: UUID | None = None
    selected_project: "ProjectRead | None" = None
    task_memory: SharedMemoryRead | None = None
    project_memory: SharedMemoryRead | None = None
    threads: list[ThreadSummaryRead]
    messages: list[MessageRead]
    runs: list[RunRead]
    run_steps: list[RunStepRead] = Field(default_factory=list)
    tool_calls: list[ToolCallRead] = Field(default_factory=list)


class ProjectRead(ReadModel):
    id: UUID
    workspace_id: UUID
    name: str
    description: str | None = None
    status: str
    metadata: dict = Field(default_factory=dict, validation_alias="metadata_")
    created_at: datetime
    updated_at: datetime


class ProjectSummaryRead(ProjectRead):
    thread_count: int = 0
    last_activity_at: datetime | None = None


class ChatProjectCreateRequest(BaseModel):
    workspace_id: UUID
    name: str = Field(min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=4000)
    connectors: list[str] = Field(default_factory=list, max_length=12)


class ChatTaskRailResponse(BaseModel):
    workspace_id: UUID
    projects: list[ProjectSummaryRead] = Field(default_factory=list)
    threads: list[ThreadSummaryRead]


class TaskTemplateChatDefaultsRead(BaseModel):
    thread_title: str
    prompt: str
    model_profile: str | None = None
    use_retrieval: bool = True
    suggested_steps: list[str] = Field(default_factory=list)


class TaskTemplateAutomationDefaultsRead(BaseModel):
    name: str
    description: str
    prompt: str
    schedule_hint: str
    timezone: str = "UTC"
    use_retrieval: bool = True
    requires_approval: bool = False
    retry_limit: int = 2
    timeout_seconds: int = 900
    notify_on: list[str] = Field(default_factory=list)
    steps: list[str] = Field(default_factory=list)


class TaskTemplateRead(BaseModel):
    key: str
    name: str
    category: Literal["browser", "computer"]
    summary: str
    description: str
    tags: list[str] = Field(default_factory=list)
    capabilities: list[str] = Field(default_factory=list)
    recommended_operator_tab: Literal[
        "code", "computer", "browser", "terminal", "files", "preview", "timeline", "artifacts"
    ] = "computer"
    requires_approval: bool = False
    chat_defaults: TaskTemplateChatDefaultsRead
    automation_defaults: TaskTemplateAutomationDefaultsRead


class ChatTaskTemplatesResponse(BaseModel):
    workspace_id: UUID
    templates: list[TaskTemplateRead] = Field(default_factory=list)


class SearchDocumentRead(ReadModel):
    id: UUID
    workspace_id: UUID
    title: str
    source_type: str
    source_uri: str | None = None
    mime_type: str | None = None
    status: str
    metadata: dict = Field(default_factory=dict, validation_alias="metadata_")
    created_at: datetime


class SearchArtifactRead(ReadModel):
    id: UUID
    run_id: UUID | None = None
    document_id: UUID | None = None
    workspace_id: UUID
    kind: str
    title: str
    storage_key: str
    metadata: dict = Field(default_factory=dict, validation_alias="metadata_")
    created_at: datetime


class ChatSearchResultRead(BaseModel):
    kind: Literal["project", "task", "document", "artifact"]
    score: float
    matched_by: list[str] = Field(default_factory=list)
    highlight: str | None = None
    project: ProjectRead | None = None
    thread: ThreadSummaryRead | None = None
    document: SearchDocumentRead | None = None
    artifact: SearchArtifactRead | None = None


class ChatSearchResponse(BaseModel):
    workspace_id: UUID
    query: str
    scope: Literal["workspace", "project"] = "workspace"
    project_id: UUID | None = None
    total_results: int
    result_counts: dict[str, int] = Field(default_factory=dict)
    searched_fields: list[str] = Field(default_factory=list)
    results: list[ChatSearchResultRead] = Field(default_factory=list)


class WorkbenchTreeEntryRead(BaseModel):
    name: str
    relative_path: str
    kind: str
    extension: str | None = None
    size_bytes: int | None = None


class ChatWorkbenchTreeResponse(BaseModel):
    workspace_id: UUID
    root_label: str
    relative_path: str
    parent_relative_path: str | None = None
    entries: list[WorkbenchTreeEntryRead] = Field(default_factory=list)


class ChatWorkbenchFileResponse(BaseModel):
    workspace_id: UUID
    root_label: str
    relative_path: str
    name: str
    extension: str | None = None
    size_bytes: int
    truncated: bool = False
    content: str
    related_files: list["WorkbenchRelatedFileRead"] = Field(default_factory=list)


class ChatWorkbenchFileUpdateRequest(BaseModel):
    workspace_id: UUID
    relative_path: str = Field(min_length=1, max_length=1024)
    content: str = Field(max_length=400000)
    create_if_missing: bool = False


class ChatWorkbenchFileSaveResponse(BaseModel):
    workspace_id: UUID
    relative_path: str
    saved_at: datetime
    file: ChatWorkbenchFileResponse


class ChatWorkbenchRepoFileRead(BaseModel):
    relative_path: str
    display_path: str
    status: str
    staged_status: str | None = None
    unstaged_status: str | None = None
    is_untracked: bool = False


class ChatWorkbenchRepoResponse(BaseModel):
    workspace_id: UUID
    is_repo: bool = False
    root_label: str
    branch: str | None = None
    head: str | None = None
    dirty: bool = False
    summary: str | None = None
    changed_files: list[ChatWorkbenchRepoFileRead] = Field(default_factory=list)
    staged_count: int = 0
    unstaged_count: int = 0
    untracked_count: int = 0


class WorkbenchRelatedFileRead(BaseModel):
    relative_path: str
    name: str
    extension: str | None = None
    reason: str
    score: int


class ChatWorkbenchBranchCreateRequest(BaseModel):
    workspace_id: UUID
    branch_name: str = Field(min_length=1, max_length=255)
    from_ref: str = Field(default="HEAD", min_length=1, max_length=255)


class ChatWorkbenchBranchCreateResponse(BaseModel):
    workspace_id: UUID
    branch_name: str
    head: str | None = None
    repo: ChatWorkbenchRepoResponse


class ChatWorkbenchCommitRequest(BaseModel):
    workspace_id: UUID
    message: str = Field(min_length=1, max_length=255)
    paths: list[str] = Field(default_factory=list)


class ChatWorkbenchCommitResponse(BaseModel):
    workspace_id: UUID
    committed: bool = False
    message: str
    commit: str | None = None
    note: str | None = None
    repo: ChatWorkbenchRepoResponse


class ChatWorkbenchPullRequestRequest(BaseModel):
    workspace_id: UUID
    title: str = Field(min_length=1, max_length=255)
    body: str | None = None
    base: str | None = Field(default=None, max_length=255)
    head: str | None = Field(default=None, max_length=255)
    draft: bool = True


class ChatWorkbenchPullRequestResponse(BaseModel):
    workspace_id: UUID
    created: bool = False
    title: str
    head: str | None = None
    base: str | None = None
    url: str | None = None
    note: str | None = None


class ChatWorkbenchRollbackRequest(BaseModel):
    workspace_id: UUID
    paths: list[str] = Field(default_factory=list)


class ChatWorkbenchRollbackResponse(BaseModel):
    workspace_id: UUID
    restored: bool = False
    restored_paths: list[str] = Field(default_factory=list)
    note: str | None = None
    repo: ChatWorkbenchRepoResponse


class ChatWorkbenchDiffResponse(BaseModel):
    workspace_id: UUID
    relative_path: str
    compare_target: str = "HEAD"
    has_changes: bool = False
    status: str | None = None
    diff: str = ""
    truncated: bool = False
    note: str | None = None


class ChatTodoSyncRequest(BaseModel):
    workspace_id: UUID
    thread_id: UUID
    relative_path: str = Field(default="todo.md", min_length=1, max_length=1024)
    heading: str | None = Field(default=None, max_length=255)


class ChatTodoSyncResponse(BaseModel):
    workspace_id: UUID
    thread_id: UUID
    relative_path: str
    created: bool = False
    total_items: int
    completed_items: int
    file: ChatWorkbenchFileResponse


class AgentToolRead(BaseModel):
    name: str
    description: str


class AgentRecentStepRead(BaseModel):
    run_step_id: UUID
    run_id: UUID
    thread_id: UUID
    thread_title: str
    project_id: UUID | None = None
    agent_key: str | None = None
    agent_name: str | None = None
    status: str
    confidence: float = 0.0
    summary: str | None = None
    validation_summary: str | None = None
    model: str | None = None
    provider: str | None = None
    tools: list[str] = Field(default_factory=list)
    created_at: datetime


class AgentWorkspaceOverviewRead(BaseModel):
    total_agents: int = 0
    configured_provider_count: int = 0
    active_agents_24h: int = 0
    busy_agents: int = 0
    idle_agents: int = 0
    total_steps: int = 0
    total_tool_calls: int = 0
    escalation_count: int = 0
    average_confidence: float = 0.0
    activity_window_hours: int = 24
    last_activity_at: datetime | None = None


class AgentSurfaceRead(BaseModel):
    key: str
    name: str
    fast_model: str
    slow_model: str
    fast_model_details: "ModelCapabilityRead"
    slow_model_details: "ModelCapabilityRead"
    specialties: list[str] = Field(default_factory=list)
    tools: list[AgentToolRead] = Field(default_factory=list)
    health_state: str = "quiet"
    workload_score: int = 0
    step_count: int = 0
    recent_step_count: int = 0
    average_confidence: float = 0.0
    escalation_count: int = 0
    tool_call_count: int = 0
    active_thread_count: int = 0
    active_project_count: int = 0
    last_active_at: datetime | None = None
    last_status: str | None = None
    last_model: str | None = None
    last_provider: str | None = None
    recent_tools: list[str] = Field(default_factory=list)
    status_breakdown: dict[str, int] = Field(default_factory=dict)
    recent_summaries: list[str] = Field(default_factory=list)
    recent_steps: list[AgentRecentStepRead] = Field(default_factory=list)


class ProviderCapabilityRead(BaseModel):
    key: str
    label: str
    family: str
    configured: bool
    supports_chat: bool
    supports_embeddings: bool
    supports_vision: bool
    detail: str


class ModelCapabilityRead(BaseModel):
    name: str
    provider_key: str
    provider_label: str
    family: str
    configured: bool
    context_window_tokens: int
    latency_tier: str
    supports_chat: bool
    supports_embeddings: bool
    supports_vision: bool
    supports_reasoning: bool
    supports_structured_output: bool
    supports_planning: bool
    supports_research: bool
    supports_coding: bool
    supports_ui_diagrams: bool
    specialties: list[str] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)


class ChatAgentsResponse(BaseModel):
    workspace_id: UUID
    supervisor_model: str
    planner_model: str
    supervisor_model_details: ModelCapabilityRead
    planner_model_details: ModelCapabilityRead
    overview: AgentWorkspaceOverviewRead
    providers: list[ProviderCapabilityRead] = Field(default_factory=list)
    model_catalog: list[ModelCapabilityRead] = Field(default_factory=list)
    agents: list[AgentSurfaceRead] = Field(default_factory=list)
    recent_activity: list[AgentRecentStepRead] = Field(default_factory=list)


class DemoWorkspaceResponse(ChatWorkspaceResponse):
    pass


ChatWorkspaceResponse.model_rebuild()
DemoWorkspaceResponse.model_rebuild()
