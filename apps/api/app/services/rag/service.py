from __future__ import annotations

import math
from collections import Counter
from hashlib import sha256
from time import perf_counter
from urllib.parse import urlparse
from uuid import UUID, uuid4

import httpx
from bs4 import BeautifulSoup
from pgvector.sqlalchemy import Vector
from sqlalchemy import desc, func, literal, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models.entities import Artifact, Document, DocumentChunk, utc_now
from app.schemas.documents import DocumentIngestRequest
from app.services.artifacts import ArtifactService
from app.services.providers.router import ProviderRouter
from app.services.rag.chunker import chunk_text, estimate_tokens
from app.services.rag.parser import DocumentParserService
from app.services.rag.retrieval import (
    RetrievalFilters,
    RetrievalObservability,
    RetrievalSearchBundle,
    describe_search_path,
    hybrid_score,
    keyword_score,
    normalize_tag,
    rerank_score,
    serialize_fallback_reason,
    signals_for_search_path,
)

settings = get_settings()


class KnowledgeService:
    def __init__(self) -> None:
        self.parser = DocumentParserService()
        self.artifacts = ArtifactService()
        self.provider_router = ProviderRouter()

    async def ingest(self, session: AsyncSession, payload: DocumentIngestRequest) -> Document:
        content = payload.content or ""
        if payload.source_type == "url" and payload.source_uri:
            content = await self._fetch_remote_text(payload.source_uri)
        if not content:
            raise ValueError("Document content could not be resolved.")
        document = await self._persist_document(
            session,
            workspace_id=payload.workspace_id,
            title=payload.title,
            source_type=payload.source_type,
            source_uri=payload.source_uri,
            mime_type="text/plain" if payload.source_type == "text" else None,
            content_text=content,
            metadata={"tags": payload.tags},
            duplicate_strategy=payload.duplicate_strategy,
        )
        await session.commit()
        await session.refresh(document)
        return document

    async def ingest_upload(
        self,
        session: AsyncSession,
        *,
        workspace_id: UUID,
        filename: str,
        payload: bytes,
        content_type: str | None,
        title: str | None = None,
        tags: list[str] | None = None,
        create_default_export: bool = True,
        duplicate_strategy: str = "mark_duplicate",
    ) -> tuple[Document, list[Artifact]]:
        parsed = self.parser.parse_bytes(filename, content_type, payload)
        document = await self._persist_document(
            session,
            workspace_id=workspace_id,
            title=title or filename,
            source_type=parsed.source_type,
            source_uri=None,
            mime_type=parsed.mime_type,
            content_text=parsed.content_text,
            metadata={"tags": tags or [], **parsed.metadata},
            duplicate_strategy=duplicate_strategy,
        )
        artifacts: list[Artifact] = []
        source_artifact = await self.artifacts.create_source_file_artifact(
            session,
            workspace_id=workspace_id,
            document_id=document.id,
            filename=filename,
            mime_type=parsed.mime_type,
            payload=payload,
            metadata={"source_type": parsed.source_type},
        )
        artifacts.append(source_artifact)
        document.metadata_ = {
            **document.metadata_,
            "source_artifact_id": str(source_artifact.id),
            "original_filename": filename,
        }
        if create_default_export:
            export_artifact = await self.artifacts.create_document_export(
                session,
                document=document,
                format="markdown",
                include_metadata=True,
            )
            artifacts.append(export_artifact)
            document.metadata_ = {
                **document.metadata_,
                "default_export_artifact_id": str(export_artifact.id),
            }
        await session.commit()
        await session.refresh(document)
        for artifact in artifacts:
            await session.refresh(artifact)
        return document, artifacts

    async def list_documents(self, session: AsyncSession, workspace_id: UUID) -> list[Document]:
        result = await session.execute(
            select(Document).where(Document.workspace_id == workspace_id).order_by(desc(Document.created_at))
        )
        return list(result.scalars().all())

    async def get_document(self, session: AsyncSession, document_id: UUID) -> Document | None:
        result = await session.execute(select(Document).where(Document.id == document_id))
        return result.scalar_one_or_none()

    async def search(
        self,
        session: AsyncSession,
        workspace_id: UUID,
        query: str,
        *,
        filters: RetrievalFilters | None = None,
    ) -> RetrievalSearchBundle:
        filters = filters or RetrievalFilters()
        started_at = perf_counter()
        candidate_limit = self._candidate_limit(filters)
        attempted_paths: list[str] = []
        candidate_counts: dict[str, int] = {}
        notes = [
            "Candidate counts reflect rows that remained after retrieval filters were applied and before final trimming."
        ]
        timings_ms: dict[str, float] = {}
        fallback_reason: str | None = None
        if filters.tags:
            notes.append("Tag filters are conjunctive, so each returned document must include every requested tag.")
        if not filters.include_duplicates:
            notes.append("Duplicate-marked documents are excluded unless they are explicitly included.")

        embedding_started_at = perf_counter()
        query_embedding_provider: str | None = None
        query_embedding_fallback = False
        try:
            try:
                query_vector, query_embedding_provider, query_embedding_fallback = await self._embed_query(
                    query,
                    workspace_id=workspace_id,
                )
            except TypeError as exc:
                if "workspace_id" not in str(exc):
                    raise
                query_vector, query_embedding_provider, query_embedding_fallback = await self._embed_query(
                    query
                )
        except Exception as exc:
            query_vector = None
            fallback_reason = serialize_fallback_reason("query_embedding_unavailable", exc)
            notes.append("Query embedding generation failed, so the semantic SQL path was skipped.")
        timings_ms["embedding"] = self._elapsed_ms(embedding_started_at)

        if query_vector is not None:
            attempted_paths.append("pgvector_sql")
            started = perf_counter()
            try:
                ranked, candidate_counts["pgvector_sql"] = await self._search_pgvector(
                    session, workspace_id, query, query_vector, filters
                )
                timings_ms["pgvector_sql"] = self._elapsed_ms(started)
                if ranked:
                    observability = self._build_observability(
                        path_used="pgvector_sql",
                        attempted_paths=attempted_paths,
                        query_vector=query_vector,
                        query_embedding_provider=query_embedding_provider,
                        query_embedding_fallback=query_embedding_fallback,
                        candidate_limit=candidate_limit,
                        candidate_counts=candidate_counts,
                        returned_count=len(ranked),
                        fallback_reason=None,
                        filters=filters,
                        notes=notes,
                        timings_ms=timings_ms,
                    )
                    observability.timings_ms["total"] = round(self._elapsed_ms(started_at), 2)
                    return RetrievalSearchBundle(results=ranked, observability=observability)
                fallback_reason = "pgvector_returned_no_ranked_matches"
                notes.append("pgvector SQL returned no positive-score rows after filters and reranking.")
            except Exception as exc:
                timings_ms["pgvector_sql"] = self._elapsed_ms(started)
                fallback_reason = serialize_fallback_reason("pgvector_query_failed", exc)
                notes.append("pgvector SQL ranking failed at runtime, so the application scorer retried.")
        else:
            notes.append("Search continued with lexical scoring because no query embedding was available.")

        attempted_paths.append("python_hybrid")
        started = perf_counter()
        ranked, candidate_counts["python_hybrid"] = await self._search_python(
            session, workspace_id, query, query_vector, filters
        )
        timings_ms["python_hybrid"] = self._elapsed_ms(started)
        observability = self._build_observability(
            path_used="python_hybrid",
            attempted_paths=attempted_paths,
            query_vector=query_vector,
            query_embedding_provider=query_embedding_provider,
            query_embedding_fallback=query_embedding_fallback,
            candidate_limit=candidate_limit,
            candidate_counts=candidate_counts,
            returned_count=len(ranked),
            fallback_reason=fallback_reason,
            filters=filters,
            notes=notes,
            timings_ms=timings_ms,
        )
        observability.timings_ms["total"] = round(self._elapsed_ms(started_at), 2)
        return RetrievalSearchBundle(results=ranked, observability=observability)

    async def backfill_embeddings(
        self,
        session: AsyncSession,
        *,
        workspace_id: UUID | None = None,
        batch_size: int = 32,
        limit: int | None = None,
    ) -> dict:
        updated = 0
        batches = 0
        remaining = limit
        while True:
            chunk_limit = batch_size if remaining is None else min(batch_size, remaining)
            if chunk_limit <= 0:
                break
            statement = select(DocumentChunk).where(DocumentChunk.embedding.is_(None)).order_by(DocumentChunk.created_at).limit(chunk_limit)
            if workspace_id is not None:
                statement = statement.where(DocumentChunk.workspace_id == workspace_id)
            result = await session.execute(statement)
            chunks = list(result.scalars().all())
            if not chunks:
                break
            vectors = await self._embed_chunks(
                [chunk.content for chunk in chunks],
                workspace_id=workspace_id,
                operation="embedding_backfill",
            )
            for index, chunk in enumerate(chunks):
                chunk.embedding = vectors[index] if index < len(vectors) else None
                chunk.metadata_ = {**chunk.metadata_, "embedding_backfilled": True}
            await session.commit()
            updated += len(chunks)
            batches += 1
            if remaining is not None:
                remaining -= len(chunks)
        statement = select(func.count()).select_from(DocumentChunk).where(DocumentChunk.embedding.is_(None))
        if workspace_id is not None:
            statement = statement.where(DocumentChunk.workspace_id == workspace_id)
        remaining_count = int((await session.execute(statement)).scalar_one())
        return {
            "updated_chunks": updated,
            "batches": batches,
            "remaining_chunks": remaining_count,
            "workspace_id": str(workspace_id) if workspace_id else None,
        }

    async def get_health_summary(self, session: AsyncSession, workspace_id: UUID) -> dict:
        documents = await self.list_documents(session, workspace_id)
        chunks = list((await session.execute(select(DocumentChunk).where(DocumentChunk.workspace_id == workspace_id))).scalars().all())
        status_breakdown = Counter(document.status for document in documents)
        source_type_breakdown = Counter(document.source_type for document in documents)
        tag_counts: Counter[str] = Counter()
        fingerprint_counts: Counter[str] = Counter()
        trust_scores: list[float] = []
        untagged_documents = 0
        for document in documents:
            trust_scores.append(self._document_trust_score(document))
            tags = [normalize_tag(str(tag)) for tag in document.metadata_.get("tags", []) if str(tag).strip()]
            if tags:
                tag_counts.update(tags)
            else:
                untagged_documents += 1
            fingerprint = document.metadata_.get("content_fingerprint")
            if fingerprint:
                fingerprint_counts[str(fingerprint)] += 1
        embedded_chunks = sum(1 for chunk in chunks if chunk.embedding is not None)
        latest_document_at = max((document.created_at for document in documents), default=None)
        return {
            "workspace_id": workspace_id,
            "total_documents": len(documents),
            "indexed_documents": sum(1 for document in documents if document.status != "duplicate"),
            "duplicate_documents": sum(1 for document in documents if document.status == "duplicate"),
            "total_chunks": len(chunks),
            "embedded_chunks": embedded_chunks,
            "embedding_coverage": round(embedded_chunks / len(chunks), 4) if chunks else 0.0,
            "average_trust_score": round(sum(trust_scores) / len(trust_scores), 4) if trust_scores else 0.0,
            "status_breakdown": dict(status_breakdown),
            "source_type_breakdown": dict(source_type_breakdown),
            "top_tags": [{"tag": tag, "count": count} for tag, count in tag_counts.most_common(6)],
            "duplicate_groups": sum(1 for count in fingerprint_counts.values() if count > 1),
            "untagged_documents": untagged_documents,
            "latest_document_at": latest_document_at,
        }

    async def _persist_document(
        self,
        session: AsyncSession,
        *,
        workspace_id: UUID,
        title: str,
        source_type: str,
        source_uri: str | None,
        mime_type: str | None,
        content_text: str,
        metadata: dict,
        duplicate_strategy: str = "mark_duplicate",
    ) -> Document:
        normalized_tags = self._normalize_tags(metadata.get("tags", []))
        content_fingerprint = self._fingerprint(content_text)
        source_domain = self._extract_domain(source_uri)
        trust_score = self._derive_trust_score(source_type=source_type, source_uri=source_uri, mime_type=mime_type)
        duplicate_document = await self._find_duplicate_document(
            session,
            workspace_id=workspace_id,
            content_fingerprint=content_fingerprint,
        )
        is_duplicate = duplicate_document is not None and duplicate_strategy == "mark_duplicate"
        document = Document(
            workspace_id=workspace_id,
            title=title,
            source_type=source_type,
            source_uri=source_uri,
            mime_type=mime_type,
            status="duplicate" if is_duplicate else "processed",
            content_text=content_text,
            metadata={
                **metadata,
                "tags": normalized_tags,
                "content_fingerprint": content_fingerprint,
                "source_domain": source_domain,
                "trust_score": trust_score,
                "duplicate_strategy": duplicate_strategy,
                "is_duplicate": is_duplicate,
                "duplicate_of_document_id": str(duplicate_document.id) if is_duplicate else None,
            },
        )
        session.add(document)
        await session.flush()
        if is_duplicate:
            document.metadata_ = {
                **document.metadata_,
                "chunk_count": 0,
                "deduplicated_chunk_count": 0,
                "indexing_skipped": True,
                "indexing_skipped_reason": "duplicate_content",
            }
            return document

        chunks = chunk_text(content_text)
        unique_chunks: list[tuple[int, str, str]] = []
        seen_fingerprints: set[str] = set()
        deduplicated_chunk_count = 0
        for source_chunk_index, chunk in enumerate(chunks):
            fingerprint = self._fingerprint(chunk)
            if fingerprint in seen_fingerprints:
                deduplicated_chunk_count += 1
                continue
            seen_fingerprints.add(fingerprint)
            unique_chunks.append((source_chunk_index, chunk, fingerprint))

        embeddings = await self._embed_chunks(
            [chunk for _, chunk, _ in unique_chunks],
            workspace_id=workspace_id,
            operation="document_ingest",
        )
        for chunk_index, (source_chunk_index, chunk, fingerprint) in enumerate(unique_chunks):
            session.add(
                DocumentChunk(
                    document_id=document.id,
                    workspace_id=workspace_id,
                    chunk_index=chunk_index,
                    content=chunk,
                    token_estimate=estimate_tokens(chunk),
                    embedding=embeddings[chunk_index] if chunk_index < len(embeddings) else None,
                    metadata={
                        "fingerprint": fingerprint,
                        "chunk_id": uuid4().hex,
                        "source_chunk_index": source_chunk_index,
                    },
                )
            )

        document.metadata_ = {
            **document.metadata_,
            "chunk_count": len(unique_chunks),
            "deduplicated_chunk_count": deduplicated_chunk_count,
            "indexing_skipped": False,
        }
        return document

    async def _fetch_remote_text(self, url: str) -> str:
        async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
            response = await client.get(url)
            response.raise_for_status()
        soup = BeautifulSoup(response.text, "html.parser")
        return soup.get_text(" ", strip=True)

    def _fingerprint(self, value: str) -> str:
        return sha256(value.encode("utf-8")).hexdigest()

    def _normalize_tags(self, tags: list[str]) -> list[str]:
        return sorted({normalize_tag(str(tag)) for tag in tags if str(tag).strip()})

    def _extract_domain(self, source_uri: str | None) -> str | None:
        if not source_uri:
            return None
        return (urlparse(source_uri).hostname or "").lower() or None

    def _derive_trust_score(self, *, source_type: str, source_uri: str | None, mime_type: str | None) -> float:
        base = {"upload": 0.92, "file": 0.92, "text": 0.72, "url": 0.74, "html": 0.7}.get(source_type, 0.68)
        domain = self._extract_domain(source_uri)
        if source_uri:
            base += 0.04 if source_uri.lower().startswith("https://") else -0.08
        if domain:
            if domain.endswith(".gov"):
                base += 0.18
            elif domain.endswith(".edu"):
                base += 0.12
            elif domain.endswith(".org"):
                base += 0.05
        if mime_type in {
            "application/pdf",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        }:
            base += 0.02
        return round(min(max(base, 0.35), 0.99), 4)

    async def _find_duplicate_document(
        self,
        session: AsyncSession,
        *,
        workspace_id: UUID,
        content_fingerprint: str,
    ) -> Document | None:
        result = await session.execute(
            select(Document).where(Document.workspace_id == workspace_id).order_by(desc(Document.created_at))
        )
        for document in result.scalars().all():
            if document.status != "duplicate" and document.metadata_.get("content_fingerprint") == content_fingerprint:
                return document
        return None

    async def _embed_chunks(
        self,
        chunks: list[str],
        *,
        workspace_id: UUID | None = None,
        operation: str = "chunk_embedding",
    ) -> list[list[float]]:
        if not chunks:
            return []
        return (
            await self.provider_router.embed(
                chunks,
                metadata={
                    "workspace_id": str(workspace_id) if workspace_id else None,
                    "operation": operation,
                },
            )
        ).vectors

    async def _embed_query(
        self,
        query: str,
        *,
        workspace_id: UUID | None = None,
    ) -> tuple[list[float] | None, str | None, bool]:
        if not query.strip():
            return None, None, False
        result = await self.provider_router.embed(
            [query],
            metadata={
                "workspace_id": str(workspace_id) if workspace_id else None,
                "operation": "query_embedding",
            },
        )
        return result.vectors[0] if result.vectors else None, result.provider, result.fallback

    def _candidate_limit(self, filters: RetrievalFilters) -> int:
        return max(8, min(max(filters.normalized_limit() * 4, 16), settings.retrieval_max_candidates))

    async def _search_pgvector(
        self,
        session: AsyncSession,
        workspace_id: UUID,
        query: str,
        query_vector: list[float],
        filters: RetrievalFilters,
    ) -> tuple[list[dict], int]:
        ts_vector = func.to_tsvector("simple", DocumentChunk.content)
        ts_query = func.plainto_tsquery("simple", query)
        query_literal = literal(query_vector, type_=Vector(settings.embedding_dimensions))
        vector_distance = DocumentChunk.embedding.op("<=>")(query_literal)
        keyword_rank = func.coalesce(func.ts_rank_cd(ts_vector, ts_query), 0.0)
        vector_rank = func.greatest(0.0, 1.0 - func.coalesce(vector_distance, 1.0))
        combined_rank = keyword_rank * settings.retrieval_keyword_weight + vector_rank * settings.retrieval_vector_weight
        statement = (
            select(
                DocumentChunk,
                Document,
                keyword_rank.label("keyword_rank"),
                vector_rank.label("vector_rank"),
                combined_rank.label("combined_rank"),
            )
            .join(Document, DocumentChunk.document_id == Document.id)
            .where(DocumentChunk.workspace_id == workspace_id)
            .where(or_(ts_vector.op("@@")(ts_query), DocumentChunk.embedding.is_not(None)))
            .order_by(desc(combined_rank), desc(keyword_rank), desc(DocumentChunk.created_at))
            .limit(self._candidate_limit(filters))
        )
        rows = (await session.execute(statement)).all()
        ranked: list[dict] = []
        filtered_candidates = 0
        for chunk, document, keyword_rank_value, vector_rank_value, combined_rank_value in rows:
            if not self._document_matches_filters(document, filters):
                continue
            filtered_candidates += 1
            base_score = float(combined_rank_value or 0.0)
            if base_score <= 0:
                continue
            _, overlap_terms = keyword_score(query, chunk.content)
            ranked.append(
                self._build_result(
                    document=document,
                    chunk=chunk,
                    base_score=base_score,
                    keyword_score_value=float(keyword_rank_value or 0.0),
                    vector_score_value=float(vector_rank_value or 0.0),
                    overlap_terms=overlap_terms,
                )
            )
        return self._select_ranked_results(ranked, filters), filtered_candidates

    async def _search_python(
        self,
        session: AsyncSession,
        workspace_id: UUID,
        query: str,
        query_vector: list[float] | None,
        filters: RetrievalFilters,
    ) -> tuple[list[dict], int]:
        statement = (
            select(DocumentChunk, Document)
            .join(Document, DocumentChunk.document_id == Document.id)
            .where(DocumentChunk.workspace_id == workspace_id)
            .order_by(desc(DocumentChunk.created_at))
            .limit(self._candidate_limit(filters))
        )
        rows = (await session.execute(statement)).all()
        ranked: list[dict] = []
        filtered_candidates = 0
        for chunk, document in rows:
            if not self._document_matches_filters(document, filters):
                continue
            filtered_candidates += 1
            score = hybrid_score(query, query_vector, chunk.content, chunk.embedding)
            if score.combined_score <= 0:
                continue
            ranked.append(
                self._build_result(
                    document=document,
                    chunk=chunk,
                    base_score=score.combined_score,
                    keyword_score_value=score.keyword_score,
                    vector_score_value=score.vector_score,
                    overlap_terms=score.overlap_terms,
                )
            )
        return self._select_ranked_results(ranked, filters), filtered_candidates

    def _document_matches_filters(self, document: Document, filters: RetrievalFilters) -> bool:
        metadata = self._document_metadata(document)
        if not filters.include_duplicates and (
            document.status == "duplicate" or bool(metadata.get("is_duplicate"))
        ):
            return False
        if filters.source_types and document.source_type not in filters.source_types:
            return False
        if filters.document_ids and document.id not in filters.document_ids:
            return False
        if filters.created_after and document.created_at < filters.created_after:
            return False
        if filters.created_before and document.created_at > filters.created_before:
            return False
        if filters.tags:
            document_tags = {
                normalize_tag(str(tag)) for tag in metadata.get("tags", []) if str(tag).strip()
            }
            if not set(filters.tags).issubset(document_tags):
                return False
        if filters.min_trust_score is not None and self._document_trust_score(document) < filters.min_trust_score:
            return False
        return True

    def _build_result(
        self,
        *,
        document: Document,
        chunk: DocumentChunk,
        base_score: float,
        keyword_score_value: float,
        vector_score_value: float,
        overlap_terms: list[str],
    ) -> dict:
        trust_score = self._document_trust_score(document)
        freshness_score = self._document_freshness_score(document)
        return {
            "chunk_id": str(chunk.id),
            "document_id": str(document.id),
            "document_title": document.title,
            "source_type": document.source_type,
            "source_uri": document.source_uri,
            "document_created_at": document.created_at,
            "content": chunk.content,
            "chunk_index": chunk.chunk_index,
            "token_estimate": chunk.token_estimate,
            "metadata": chunk.metadata_,
            "score": rerank_score(base_score, trust_score, freshness_score),
            "base_score": round(float(base_score), 4),
            "keyword_score": round(float(keyword_score_value), 4),
            "vector_score": round(float(vector_score_value), 4),
            "trust_score": trust_score,
            "freshness_score": freshness_score,
            "overlap_terms": overlap_terms,
            "is_duplicate": document.status == "duplicate" or bool(document.metadata_.get("is_duplicate")),
            "duplicate_of_document_id": document.metadata_.get("duplicate_of_document_id"),
        }

    def _select_ranked_results(self, ranked: list[dict], filters: RetrievalFilters) -> list[dict]:
        per_document_limit = max(1, settings.retrieval_max_chunks_per_document)
        selected_per_document: Counter[str] = Counter()
        selected: list[dict] = []
        ranked.sort(
            key=lambda item: (
                item["score"],
                item["trust_score"],
                item["freshness_score"],
                item["document_created_at"],
            ),
            reverse=True,
        )
        for item in ranked:
            document_id = item["document_id"]
            if selected_per_document[document_id] >= per_document_limit:
                continue
            selected.append(item)
            selected_per_document[document_id] += 1
            if len(selected) >= filters.normalized_limit():
                break
        return selected

    def _document_trust_score(self, document: Document) -> float:
        configured = self._document_metadata(document).get("trust_score")
        if isinstance(configured, (int, float)):
            return round(float(configured), 4)
        return self._derive_trust_score(
            source_type=document.source_type,
            source_uri=getattr(document, "source_uri", None),
            mime_type=getattr(document, "mime_type", None),
        )

    def _document_metadata(self, document: Document | Any) -> dict[str, Any]:
        metadata = getattr(document, "metadata_", None)
        if isinstance(metadata, dict):
            return metadata
        metadata = getattr(document, "metadata", None)
        return metadata if isinstance(metadata, dict) else {}

    def _document_freshness_score(self, document: Document) -> float:
        age_days = max((utc_now() - document.created_at).total_seconds() / 86400, 0.0)
        return round(min(max(0.35 + 0.65 * math.exp(-age_days / 365), 0.0), 1.0), 4)

    def _build_observability(
        self,
        *,
        path_used: str,
        attempted_paths: list[str],
        query_vector: list[float] | None,
        query_embedding_provider: str | None,
        query_embedding_fallback: bool,
        candidate_limit: int,
        candidate_counts: dict[str, int],
        returned_count: int,
        fallback_reason: str | None,
        filters: RetrievalFilters,
        notes: list[str],
        timings_ms: dict[str, float],
    ) -> RetrievalObservability:
        query_embedding_available = query_vector is not None
        fallback_triggered = path_used == "python_hybrid" and "pgvector_sql" in attempted_paths
        normalized_notes = list(notes)
        if path_used == "pgvector_sql":
            normalized_notes.append(
                "PostgreSQL handled lexical and vector ranking before trust and freshness reranking."
            )
        elif query_embedding_available:
            normalized_notes.append(
                "The Python fallback path combined keyword overlap and cosine similarity before the final rerank."
            )
        return RetrievalObservability(
            path_used=path_used,
            attempted_paths=list(attempted_paths),
            reason=describe_search_path(
                path_used,
                query_embedding_available=query_embedding_available,
                fallback_reason=fallback_reason,
                fallback_triggered=fallback_triggered,
            ),
            fallback_triggered=fallback_triggered,
            fallback_reason=fallback_reason,
            query_embedding_available=query_embedding_available,
            query_embedding_dimensions=len(query_vector) if query_vector else None,
            query_embedding_provider=query_embedding_provider,
            query_embedding_fallback=query_embedding_fallback,
            candidate_limit=candidate_limit,
            candidate_counts=dict(candidate_counts),
            returned_count=returned_count,
            signals_considered=signals_for_search_path(path_used, query_embedding_available=query_embedding_available),
            weights={
                "keyword": round(settings.retrieval_keyword_weight, 4),
                "vector": round(settings.retrieval_vector_weight, 4),
                "trust": round(settings.retrieval_trust_weight, 4),
                "freshness": round(settings.retrieval_freshness_weight, 4),
            },
            timings_ms={key: round(value, 2) for key, value in timings_ms.items()},
            notes=normalized_notes,
            filters_applied=filters.to_dict(),
            max_chunks_per_document=settings.retrieval_max_chunks_per_document,
            rerank_strategy="hybrid_similarity_plus_trust_and_freshness",
        )

    def _elapsed_ms(self, started_at: float) -> float:
        return (perf_counter() - started_at) * 1000
