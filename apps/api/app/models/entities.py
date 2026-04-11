from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import UUID, uuid4

from pgvector.sqlalchemy import Vector
from sqlalchemy import JSON, Boolean, Column, DateTime, Float, Integer, String, Text
from sqlmodel import Field, SQLModel


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class BaseRecord(SQLModel):
    id: UUID = Field(default_factory=uuid4, primary_key=True, index=True)
    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False, index=True),
    )
    updated_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class Organization(BaseRecord, table=True):
    name: str = Field(sa_column=Column(String(255), nullable=False))
    slug: str = Field(sa_column=Column(String(255), nullable=False, unique=True, index=True))


class User(BaseRecord, table=True):
    email: str = Field(sa_column=Column(String(255), nullable=False, unique=True, index=True))
    full_name: str = Field(sa_column=Column(String(255), nullable=False))
    role: str = Field(default="member", sa_column=Column(String(64), nullable=False))
    organization_id: UUID = Field(foreign_key="organization.id", nullable=False)
    password_hash: str = Field(default="", sa_column=Column(String(512), nullable=False))
    is_active: bool = Field(default=True, sa_column=Column(Boolean, nullable=False))
    last_login_at: datetime | None = Field(default=None, sa_column=Column(DateTime(timezone=True)))


class Workspace(BaseRecord, table=True):
    organization_id: UUID = Field(foreign_key="organization.id", nullable=False, index=True)
    name: str = Field(sa_column=Column(String(255), nullable=False))
    slug: str = Field(sa_column=Column(String(255), nullable=False, unique=True, index=True))
    description: str | None = Field(default=None, sa_column=Column(Text))


class WorkspaceMembership(BaseRecord, table=True):
    workspace_id: UUID = Field(foreign_key="workspace.id", nullable=False, index=True)
    user_id: UUID = Field(foreign_key="user.id", nullable=False, index=True)
    role: str = Field(default="member", sa_column=Column(String(64), nullable=False))
    status: str = Field(default="active", sa_column=Column(String(64), nullable=False))


class Project(BaseRecord, table=True):
    workspace_id: UUID = Field(foreign_key="workspace.id", nullable=False, index=True)
    name: str = Field(sa_column=Column(String(255), nullable=False))
    description: str | None = Field(default=None, sa_column=Column(Text))
    status: str = Field(default="active", sa_column=Column(String(64), nullable=False))


class ChatThread(BaseRecord, table=True):
    workspace_id: UUID = Field(foreign_key="workspace.id", nullable=False, index=True)
    project_id: UUID | None = Field(default=None, foreign_key="project.id")
    title: str = Field(sa_column=Column(String(255), nullable=False))
    status: str = Field(default="active", sa_column=Column(String(64), nullable=False))
    metadata: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON, nullable=False))


class Run(BaseRecord, table=True):
    thread_id: UUID = Field(foreign_key="chatthread.id", nullable=False, index=True)
    workspace_id: UUID = Field(foreign_key="workspace.id", nullable=False, index=True)
    status: str = Field(default="queued", sa_column=Column(String(64), nullable=False, index=True))
    supervisor_model: str = Field(sa_column=Column(String(255), nullable=False))
    user_message: str = Field(sa_column=Column(Text, nullable=False))
    final_response: str | None = Field(default=None, sa_column=Column(Text))
    summary: str | None = Field(default=None, sa_column=Column(Text))
    plan: list[dict[str, Any]] = Field(default_factory=list, sa_column=Column(JSON, nullable=False))


class Message(BaseRecord, table=True):
    thread_id: UUID = Field(foreign_key="chatthread.id", nullable=False, index=True)
    run_id: UUID | None = Field(default=None, foreign_key="run.id")
    role: str = Field(sa_column=Column(String(32), nullable=False))
    content: str = Field(sa_column=Column(Text, nullable=False))
    citations: list[dict[str, Any]] = Field(default_factory=list, sa_column=Column(JSON, nullable=False))
    metadata: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON, nullable=False))


class RunStep(BaseRecord, table=True):
    run_id: UUID = Field(foreign_key="run.id", nullable=False, index=True)
    agent_name: str = Field(sa_column=Column(String(128), nullable=False))
    step_index: int = Field(sa_column=Column(Integer, nullable=False))
    status: str = Field(default="queued", sa_column=Column(String(64), nullable=False))
    confidence: float = Field(default=0.0, sa_column=Column(Float, nullable=False))
    input_payload: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON, nullable=False))
    output_payload: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON, nullable=False))


class ToolCall(BaseRecord, table=True):
    run_step_id: UUID = Field(foreign_key="runstep.id", nullable=False, index=True)
    tool_name: str = Field(sa_column=Column(String(128), nullable=False))
    status: str = Field(default="queued", sa_column=Column(String(64), nullable=False))
    input_payload: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON, nullable=False))
    output_payload: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON, nullable=False))


class Document(BaseRecord, table=True):
    workspace_id: UUID = Field(foreign_key="workspace.id", nullable=False, index=True)
    title: str = Field(sa_column=Column(String(255), nullable=False))
    source_type: str = Field(sa_column=Column(String(64), nullable=False))
    source_uri: str | None = Field(default=None, sa_column=Column(String(1024)))
    mime_type: str | None = Field(default=None, sa_column=Column(String(255)))
    status: str = Field(default="processed", sa_column=Column(String(64), nullable=False))
    content_text: str = Field(sa_column=Column(Text, nullable=False))
    metadata: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON, nullable=False))


class DocumentChunk(BaseRecord, table=True):
    document_id: UUID = Field(foreign_key="document.id", nullable=False, index=True)
    workspace_id: UUID = Field(foreign_key="workspace.id", nullable=False, index=True)
    chunk_index: int = Field(sa_column=Column(Integer, nullable=False))
    content: str = Field(sa_column=Column(Text, nullable=False))
    token_estimate: int = Field(default=0, sa_column=Column(Integer, nullable=False))
    embedding: list[float] | None = Field(default=None, sa_column=Column(Vector(1536), nullable=True))
    metadata: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON, nullable=False))


class Artifact(BaseRecord, table=True):
    run_id: UUID | None = Field(default=None, foreign_key="run.id", index=True)
    document_id: UUID | None = Field(default=None, foreign_key="document.id", index=True)
    workspace_id: UUID = Field(foreign_key="workspace.id", nullable=False, index=True)
    kind: str = Field(sa_column=Column(String(64), nullable=False))
    title: str = Field(sa_column=Column(String(255), nullable=False))
    storage_key: str = Field(sa_column=Column(String(1024), nullable=False))
    metadata: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON, nullable=False))


class Automation(BaseRecord, table=True):
    workspace_id: UUID = Field(foreign_key="workspace.id", nullable=False, index=True)
    name: str = Field(sa_column=Column(String(255), nullable=False))
    description: str = Field(sa_column=Column(Text, nullable=False))
    schedule: str = Field(sa_column=Column(String(255), nullable=False))
    status: str = Field(default="active", sa_column=Column(String(64), nullable=False))
    definition: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON, nullable=False))
    last_run_at: datetime | None = Field(default=None, sa_column=Column(DateTime(timezone=True)))
    next_run_at: datetime | None = Field(default=None, sa_column=Column(DateTime(timezone=True)))


class AutomationExecution(BaseRecord, table=True):
    automation_id: UUID = Field(foreign_key="automation.id", nullable=False, index=True)
    workspace_id: UUID = Field(foreign_key="workspace.id", nullable=False, index=True)
    run_id: UUID | None = Field(default=None, foreign_key="run.id", index=True)
    thread_id: UUID | None = Field(default=None, foreign_key="chatthread.id", index=True)
    status: str = Field(default="queued", sa_column=Column(String(64), nullable=False, index=True))
    trigger: str = Field(default="scheduled", sa_column=Column(String(64), nullable=False))
    attempt: int = Field(default=1, sa_column=Column(Integer, nullable=False))
    started_at: datetime | None = Field(default=None, sa_column=Column(DateTime(timezone=True)))
    completed_at: datetime | None = Field(default=None, sa_column=Column(DateTime(timezone=True)))
    error_message: str | None = Field(default=None, sa_column=Column(Text))
    result_summary: str | None = Field(default=None, sa_column=Column(Text))
    metadata: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON, nullable=False))


class ProviderConfig(BaseRecord, table=True):
    organization_id: UUID | None = Field(default=None, foreign_key="organization.id")
    provider_name: str = Field(sa_column=Column(String(128), nullable=False))
    label: str = Field(sa_column=Column(String(255), nullable=False))
    base_url: str = Field(sa_column=Column(String(1024), nullable=False))
    model_mapping: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON, nullable=False))
    is_active: bool = Field(default=True)


class UserSession(BaseRecord, table=True):
    user_id: UUID = Field(foreign_key="user.id", nullable=False, index=True)
    token_hash: str = Field(sa_column=Column(String(128), nullable=False, unique=True, index=True))
    expires_at: datetime = Field(sa_column=Column(DateTime(timezone=True), nullable=False, index=True))
    last_seen_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    user_agent: str | None = Field(default=None, sa_column=Column(String(512)))
    ip_address: str | None = Field(default=None, sa_column=Column(String(128)))
    revoked_at: datetime | None = Field(default=None, sa_column=Column(DateTime(timezone=True)))


class AuditLog(BaseRecord, table=True):
    actor_id: UUID | None = Field(default=None, foreign_key="user.id")
    workspace_id: UUID | None = Field(default=None, foreign_key="workspace.id")
    action: str = Field(sa_column=Column(String(255), nullable=False, index=True))
    resource_type: str = Field(sa_column=Column(String(128), nullable=False))
    resource_id: str = Field(sa_column=Column(String(255), nullable=False))
    details: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON, nullable=False))


class UsageEvent(BaseRecord, table=True):
    organization_id: UUID | None = Field(default=None, foreign_key="organization.id")
    workspace_id: UUID | None = Field(default=None, foreign_key="workspace.id")
    provider_name: str = Field(sa_column=Column(String(128), nullable=False))
    model_name: str = Field(sa_column=Column(String(255), nullable=False))
    prompt_tokens: int = Field(default=0, sa_column=Column(Integer, nullable=False))
    completion_tokens: int = Field(default=0, sa_column=Column(Integer, nullable=False))
    estimated_cost: float = Field(default=0.0, sa_column=Column(Float, nullable=False))
