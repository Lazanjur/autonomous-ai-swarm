from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.common import ReadModel


class DocumentIngestRequest(BaseModel):
    workspace_id: UUID
    title: str
    source_type: str = "text"
    source_uri: str | None = None
    content: str | None = None
    tags: list[str] = Field(default_factory=list)
    duplicate_strategy: str = "mark_duplicate"


class DocumentRead(ReadModel):
    id: UUID
    workspace_id: UUID
    title: str
    source_type: str
    source_uri: str | None
    mime_type: str | None
    status: str
    content_text: str
    metadata: dict
    created_at: datetime


class KnowledgeSearchResultRead(BaseModel):
    chunk_id: str
    document_id: str
    document_title: str
    source_type: str
    source_uri: str | None = None
    document_created_at: datetime
    content: str
    chunk_index: int
    token_estimate: int
    metadata: dict
    score: float
    base_score: float
    keyword_score: float
    vector_score: float
    trust_score: float
    freshness_score: float
    is_duplicate: bool = False
    duplicate_of_document_id: str | None = None
    overlap_terms: list[str] = Field(default_factory=list)


class RetrievalWeightsRead(BaseModel):
    keyword: float
    vector: float
    trust: float
    freshness: float


class RetrievalObservabilityRead(BaseModel):
    path_used: str
    attempted_paths: list[str] = Field(default_factory=list)
    reason: str
    fallback_triggered: bool = False
    fallback_reason: str | None = None
    query_embedding_available: bool = False
    query_embedding_dimensions: int | None = None
    query_embedding_provider: str | None = None
    query_embedding_fallback: bool = False
    candidate_limit: int
    candidate_counts: dict[str, int] = Field(default_factory=dict)
    returned_count: int
    signals_considered: list[str] = Field(default_factory=list)
    weights: RetrievalWeightsRead
    timings_ms: dict[str, float] = Field(default_factory=dict)
    notes: list[str] = Field(default_factory=list)
    filters_applied: dict = Field(default_factory=dict)
    max_chunks_per_document: int
    rerank_strategy: str


class KnowledgeSearchResponse(BaseModel):
    query: str
    results: list[KnowledgeSearchResultRead]
    observability: RetrievalObservabilityRead


class EmbeddingBackfillRequest(BaseModel):
    workspace_id: UUID | None = None
    batch_size: int = Field(default=32, ge=1, le=256)
    limit: int | None = Field(default=None, ge=1, le=10000)


class EmbeddingBackfillResponse(BaseModel):
    updated_chunks: int
    batches: int
    remaining_chunks: int
    workspace_id: str | None


class KnowledgeTagMetricRead(BaseModel):
    tag: str
    count: int


class KnowledgeHealthResponse(BaseModel):
    workspace_id: UUID
    total_documents: int
    indexed_documents: int
    duplicate_documents: int
    total_chunks: int
    embedded_chunks: int
    embedding_coverage: float
    average_trust_score: float
    status_breakdown: dict[str, int] = Field(default_factory=dict)
    source_type_breakdown: dict[str, int] = Field(default_factory=dict)
    top_tags: list[KnowledgeTagMetricRead] = Field(default_factory=list)
    duplicate_groups: int
    untagged_documents: int
    latest_document_at: datetime | None = None
