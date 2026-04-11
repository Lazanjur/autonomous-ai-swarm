from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field

from app.schemas.common import ReadModel


class AuthRegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=10)
    full_name: str = Field(min_length=2, max_length=255)
    organization_name: str | None = None
    workspace_name: str | None = None


class AuthLoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=10)


class AuthUserRead(ReadModel):
    id: UUID
    email: EmailStr
    full_name: str
    role: str
    is_active: bool


class WorkspaceAccessRead(BaseModel):
    workspace_id: UUID
    workspace_name: str
    workspace_slug: str
    role: str


class AuthSessionRead(BaseModel):
    token: str
    expires_at: datetime
    user: AuthUserRead
    workspaces: list[WorkspaceAccessRead]


class AuthProfileRead(BaseModel):
    user: AuthUserRead
    workspaces: list[WorkspaceAccessRead]
