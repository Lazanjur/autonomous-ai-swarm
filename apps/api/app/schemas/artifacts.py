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


class ArtifactTablePreviewRead(BaseModel):
    columns: list[str] = Field(default_factory=list)
    rows: list[list[str]] = Field(default_factory=list)


class ArtifactSheetPreviewRead(BaseModel):
    name: str
    columns: list[str] = Field(default_factory=list)
    rows: list[list[str]] = Field(default_factory=list)


class ArtifactSlidePreviewRead(BaseModel):
    slide_number: int
    title: str | None = None
    bullets: list[str] = Field(default_factory=list)


class ArtifactPreviewRead(BaseModel):
    artifact_id: UUID
    workspace_id: UUID
    title: str
    kind: str
    mime_type: str
    preview_kind: str
    inline_supported: bool = False
    text_content: str | None = None
    page_summaries: list[str] = Field(default_factory=list)
    table: ArtifactTablePreviewRead | None = None
    sheets: list[ArtifactSheetPreviewRead] = Field(default_factory=list)
    slides: list[ArtifactSlidePreviewRead] = Field(default_factory=list)
    metadata: dict = Field(default_factory=dict)
    warnings: list[str] = Field(default_factory=list)
    size_bytes: int | None = None


class ArtifactGenerateRequest(BaseModel):
    format: str = Field(default="markdown", pattern="^(markdown|txt|json)$")
    include_metadata: bool = True


class DocumentUploadResponse(BaseModel):
    documents: list[DocumentRead]
    artifacts: list[ArtifactRead]
