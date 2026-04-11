from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.common import ReadModel


class ThreadRead(ReadModel):
    id: UUID
    workspace_id: UUID
    title: str
    status: str
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
    metadata: dict = Field(default_factory=dict)
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


class ChatRunRequest(BaseModel):
    workspace_id: UUID
    thread_id: UUID | None = None
    message: str
    mode: str = "autonomous"
    use_retrieval: bool = True


class ChatRunResponse(BaseModel):
    thread: ThreadRead
    run: RunRead
    messages: list[MessageRead]


class ChatThreadCreateRequest(BaseModel):
    workspace_id: UUID
    title: str | None = None


class ChatWorkspaceResponse(BaseModel):
    workspace_id: UUID
    selected_thread_id: UUID | None = None
    threads: list[ThreadSummaryRead]
    messages: list[MessageRead]
    runs: list[RunRead]


class DemoWorkspaceResponse(ChatWorkspaceResponse):
    pass
