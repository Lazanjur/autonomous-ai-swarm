from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class LibraryCollectionRead(BaseModel):
    name: str
    item_count: int
    document_count: int = 0
    artifact_count: int = 0
    pinned_count: int = 0
    reusable_count: int = 0
    recent_titles: list[str] = Field(default_factory=list)


class LibraryTagMetricRead(BaseModel):
    tag: str
    count: int


class LibraryItemRead(BaseModel):
    id: UUID
    item_type: str
    workspace_id: UUID
    title: str
    subtitle: str | None = None
    status: str
    kind: str
    mime_type: str | None = None
    source_uri: str | None = None
    storage_key: str | None = None
    document_id: UUID | None = None
    artifact_id: UUID | None = None
    linked_document_id: UUID | None = None
    linked_document_title: str | None = None
    tags: list[str] = Field(default_factory=list)
    collections: list[str] = Field(default_factory=list)
    pinned: bool = False
    reusable: bool = False
    note: str | None = None
    preview_text: str | None = None
    metadata: dict = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime


class LibraryStatsRead(BaseModel):
    total_items: int
    total_documents: int
    total_artifacts: int
    pinned_items: int
    reusable_items: int
    collection_count: int
    tagged_items: int
    unfiled_items: int


class LibraryDashboardRead(BaseModel):
    workspace_id: UUID
    stats: LibraryStatsRead
    collections: list[LibraryCollectionRead] = Field(default_factory=list)
    top_tags: list[LibraryTagMetricRead] = Field(default_factory=list)
    items: list[LibraryItemRead] = Field(default_factory=list)


class LibraryItemUpdateRequest(BaseModel):
    pinned: bool | None = None
    reusable: bool | None = None
    note: str | None = None
    tags: list[str] | None = None
    collections: list[str] | None = None
