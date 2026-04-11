from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.common import ReadModel
from app.schemas.documents import DocumentRead


class ArtifactRead(ReadModel):
    id: UUID
    run_id: UUID | None
    document_id: UUID | None
    workspace_id: UUID
    kind: str
    title: str
    storage_key: str
    metadata: dict
    created_at: datetime


class ArtifactGenerateRequest(BaseModel):
    format: str = Field(default="markdown", pattern="^(markdown|txt|json)$")
    include_metadata: bool = True


class DocumentUploadResponse(BaseModel):
    documents: list[DocumentRead]
    artifacts: list[ArtifactRead]
