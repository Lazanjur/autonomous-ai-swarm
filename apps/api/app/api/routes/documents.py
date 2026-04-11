from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import AuthContext, require_auth_context
from app.db.session import get_session
from app.schemas.artifacts import ArtifactGenerateRequest, ArtifactRead, DocumentUploadResponse
from app.schemas.documents import (
    DocumentIngestRequest,
    DocumentRead,
    EmbeddingBackfillRequest,
    EmbeddingBackfillResponse,
    KnowledgeHealthResponse,
    KnowledgeSearchResponse,
)
from app.services.artifacts import ArtifactService
from app.services.auth import AuthService
from app.services.rag.retrieval import RetrievalFilters, normalize_tag
from app.services.rag.service import KnowledgeService

router = APIRouter()
knowledge_service = KnowledgeService()
auth_service = AuthService()
artifact_service = ArtifactService()


def _parse_csv(value: str | None) -> list[str]:
    return [item.strip() for item in (value or "").split(",") if item.strip()]


@router.get("", response_model=list[DocumentRead])
async def list_documents(
    workspace_id: UUID = Query(...),
    context: AuthContext = Depends(require_auth_context),
    session: AsyncSession = Depends(get_session),
) -> list[DocumentRead]:
    await auth_service.assert_workspace_access(
        session,
        user_id=context.user.id,
        workspace_id=workspace_id,
        min_role="viewer",
    )
    documents = await knowledge_service.list_documents(session, workspace_id)
    return [DocumentRead.model_validate(document) for document in documents]


@router.post("/ingest", response_model=DocumentRead)
async def ingest_document(
    payload: DocumentIngestRequest,
    context: AuthContext = Depends(require_auth_context),
    session: AsyncSession = Depends(get_session),
) -> DocumentRead:
    await auth_service.assert_workspace_access(
        session,
        user_id=context.user.id,
        workspace_id=payload.workspace_id,
        min_role="member",
    )
    try:
        document = await knowledge_service.ingest(session, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return DocumentRead.model_validate(document)


@router.post("/upload", response_model=DocumentUploadResponse)
async def upload_documents(
    workspace_id: UUID = Form(...),
    files: list[UploadFile] = File(...),
    tags: str | None = Form(default=None),
    duplicate_strategy: str = Form(default="mark_duplicate"),
    context: AuthContext = Depends(require_auth_context),
    session: AsyncSession = Depends(get_session),
) -> DocumentUploadResponse:
    await auth_service.assert_workspace_access(
        session,
        user_id=context.user.id,
        workspace_id=workspace_id,
        min_role="member",
    )
    parsed_tags = [tag.strip() for tag in (tags or "").split(",") if tag.strip()]
    documents = []
    artifacts = []
    for upload in files:
        payload = await upload.read()
        if not payload:
            raise HTTPException(status_code=400, detail=f"`{upload.filename}` is empty.")
        try:
            document, created_artifacts = await knowledge_service.ingest_upload(
                session,
                workspace_id=workspace_id,
                filename=upload.filename or "upload",
                payload=payload,
                content_type=upload.content_type,
                tags=parsed_tags,
                duplicate_strategy=duplicate_strategy,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        documents.append(DocumentRead.model_validate(document))
        artifacts.extend(ArtifactRead.model_validate(item) for item in created_artifacts)
    return DocumentUploadResponse(documents=documents, artifacts=artifacts)


@router.post("/{document_id}/artifacts", response_model=ArtifactRead)
async def create_document_artifact(
    document_id: UUID,
    payload: ArtifactGenerateRequest,
    context: AuthContext = Depends(require_auth_context),
    session: AsyncSession = Depends(get_session),
) -> ArtifactRead:
    document = await knowledge_service.get_document(session, document_id)
    if document is None:
        raise HTTPException(status_code=404, detail="Document not found.")
    await auth_service.assert_workspace_access(
        session,
        user_id=context.user.id,
        workspace_id=document.workspace_id,
        min_role="member",
    )
    artifact = await artifact_service.create_document_export(
        session,
        document=document,
        format=payload.format,
        include_metadata=payload.include_metadata,
    )
    await session.commit()
    await session.refresh(artifact)
    return ArtifactRead.model_validate(artifact)


@router.post("/backfill-embeddings", response_model=EmbeddingBackfillResponse)
async def backfill_embeddings(
    payload: EmbeddingBackfillRequest,
    context: AuthContext = Depends(require_auth_context),
    session: AsyncSession = Depends(get_session),
) -> EmbeddingBackfillResponse:
    if payload.workspace_id is not None:
        await auth_service.assert_workspace_access(
            session,
            user_id=context.user.id,
            workspace_id=payload.workspace_id,
            min_role="member",
        )
    elif context.user.role != "owner":
        raise HTTPException(status_code=403, detail="Only owners can run global embedding backfills.")

    result = await knowledge_service.backfill_embeddings(
        session,
        workspace_id=payload.workspace_id,
        batch_size=payload.batch_size,
        limit=payload.limit,
    )
    return EmbeddingBackfillResponse(**result)


@router.get("/search", response_model=KnowledgeSearchResponse)
async def search_knowledge(
    workspace_id: UUID = Query(...),
    query: str = Query(..., min_length=2),
    source_types: str | None = Query(default=None),
    tags: str | None = Query(default=None),
    document_ids: str | None = Query(default=None),
    created_after: datetime | None = Query(default=None),
    created_before: datetime | None = Query(default=None),
    min_trust_score: float | None = Query(default=None, ge=0.0, le=1.0),
    include_duplicates: bool = Query(default=False),
    limit: int | None = Query(default=None, ge=1, le=24),
    context: AuthContext = Depends(require_auth_context),
    session: AsyncSession = Depends(get_session),
) -> KnowledgeSearchResponse:
    await auth_service.assert_workspace_access(
        session,
        user_id=context.user.id,
        workspace_id=workspace_id,
        min_role="viewer",
    )
    resolved_document_ids: list[UUID] = []
    for raw in _parse_csv(document_ids):
        try:
            resolved_document_ids.append(UUID(raw))
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=f"Invalid document id `{raw}`.") from exc
    filters = RetrievalFilters(
        source_types=_parse_csv(source_types),
        tags=[normalize_tag(item) for item in _parse_csv(tags)],
        document_ids=resolved_document_ids,
        created_after=created_after,
        created_before=created_before,
        min_trust_score=min_trust_score,
        include_duplicates=include_duplicates,
        limit=limit,
    )
    search_bundle = await knowledge_service.search(session, workspace_id, query, filters=filters)
    return KnowledgeSearchResponse(
        query=query,
        results=search_bundle.results,
        observability=search_bundle.observability.to_dict(),
    )


@router.get("/health", response_model=KnowledgeHealthResponse)
async def knowledge_health(
    workspace_id: UUID = Query(...),
    context: AuthContext = Depends(require_auth_context),
    session: AsyncSession = Depends(get_session),
) -> KnowledgeHealthResponse:
    await auth_service.assert_workspace_access(
        session,
        user_id=context.user.id,
        workspace_id=workspace_id,
        min_role="viewer",
    )
    return KnowledgeHealthResponse(**(await knowledge_service.get_health_summary(session, workspace_id)))
