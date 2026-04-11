from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.services.providers.router import MockLocalProvider
from app.services.rag.retrieval import RetrievalFilters, cosine_similarity, hybrid_score, keyword_score, rerank_score
from app.services.providers.base import EmbeddingRequest
from app.services.rag.service import KnowledgeService


def test_keyword_score_rewards_overlap_and_phrase():
    score, overlap = keyword_score(
        "market expansion strategy",
        "This market expansion strategy outlines pricing and launch steps.",
    )

    assert score > 0.6
    assert "market" in overlap
    assert "strategy" in overlap


def test_cosine_similarity_handles_identical_vectors():
    similarity = cosine_similarity([1.0, 0.0, 0.0], [1.0, 0.0, 0.0])
    assert similarity == 1.0


def test_hybrid_score_combines_keyword_and_vector_signals():
    score = hybrid_score(
        "board memo",
        [1.0, 0.0],
        "Prepare a board memo with launch risks.",
        [1.0, 0.0],
    )

    assert score.keyword_score > 0
    assert score.vector_score == 1.0
    assert score.combined_score > 0.5


async def test_mock_embedding_provider_returns_configured_dimensions():
    provider = MockLocalProvider()
    result = await provider.embed(
        EmbeddingRequest(model="local-test", inputs=["alpha beta"], dimensions=16)
    )

    assert len(result.vectors) == 1
    assert len(result.vectors[0]) == 16


async def test_mock_embedding_provider_is_stable_for_same_input():
    provider = MockLocalProvider()
    first = await provider.embed(EmbeddingRequest(model="local-test", inputs=["alpha beta"], dimensions=16))
    second = await provider.embed(EmbeddingRequest(model="local-test", inputs=["alpha beta"], dimensions=16))

    assert first.vectors[0] == second.vectors[0]


def _search_result(document_title: str = "Launch Memo") -> dict:
    return {
        "chunk_id": "chunk-1",
        "document_id": "document-1",
        "document_title": document_title,
        "source_type": "upload",
        "source_uri": None,
        "document_created_at": "2026-04-10T00:00:00+00:00",
        "content": "Board memo for launch sequencing.",
        "chunk_index": 0,
        "token_estimate": 24,
        "metadata": {"fingerprint": "abc123"},
        "score": 0.91,
        "base_score": 0.83,
        "keyword_score": 0.66,
        "vector_score": 0.88,
        "trust_score": 0.92,
        "freshness_score": 0.97,
        "is_duplicate": False,
        "duplicate_of_document_id": None,
        "overlap_terms": ["board", "memo"],
    }


def test_rerank_score_rewards_trust_and_freshness():
    boosted = rerank_score(0.6, 0.95, 0.9)
    baseline = rerank_score(0.6, 0.2, 0.2)

    assert boosted > baseline


def test_select_ranked_results_respects_per_document_cap():
    service = KnowledgeService()
    filters = RetrievalFilters(limit=4)
    ranked = [
        {
            "document_id": "doc-1",
            "score": 1.0,
            "trust_score": 0.9,
            "freshness_score": 0.9,
            "document_created_at": "2026-04-10T00:00:00+00:00",
        },
        {
            "document_id": "doc-1",
            "score": 0.95,
            "trust_score": 0.9,
            "freshness_score": 0.9,
            "document_created_at": "2026-04-10T00:00:00+00:00",
        },
        {
            "document_id": "doc-1",
            "score": 0.94,
            "trust_score": 0.9,
            "freshness_score": 0.9,
            "document_created_at": "2026-04-10T00:00:00+00:00",
        },
        {
            "document_id": "doc-2",
            "score": 0.93,
            "trust_score": 0.8,
            "freshness_score": 0.8,
            "document_created_at": "2026-04-10T00:00:00+00:00",
        },
    ]

    selected = service._select_ranked_results(ranked, filters)

    assert len([item for item in selected if item["document_id"] == "doc-1"]) <= 2
    assert len(selected) == 3


def test_document_matches_filters_excludes_duplicates_and_respects_tags():
    service = KnowledgeService()
    document = SimpleNamespace(
        id=uuid4(),
        status="duplicate",
        source_type="upload",
        created_at=datetime.now(timezone.utc),
        metadata={"tags": ["finance", "q2"], "trust_score": 0.92, "is_duplicate": True},
    )
    filters = RetrievalFilters(tags=["finance"], include_duplicates=False, min_trust_score=0.8)

    assert service._document_matches_filters(document, filters) is False

    filters.include_duplicates = True
    document.status = "processed"
    document.created_at = document.created_at - timedelta(days=2)
    assert service._document_matches_filters(document, filters) is True


@pytest.mark.asyncio
async def test_search_observability_reports_pgvector_sql_success(monkeypatch):
    service = KnowledgeService()

    async def fake_embed_query(query: str):
        assert query == "pricing strategy"
        return [0.1, 0.2], "alibaba-compatible", False

    async def fake_search_pgvector(session, workspace_id, query, query_vector, filters):
        assert workspace_id
        assert query == "pricing strategy"
        assert query_vector == [0.1, 0.2]
        assert isinstance(filters, RetrievalFilters)
        return [_search_result("Pricing Strategy")], 6

    async def fail_python(*args, **kwargs):
        raise AssertionError("Python fallback should not run when pgvector search succeeds.")

    monkeypatch.setattr(service, "_embed_query", fake_embed_query)
    monkeypatch.setattr(service, "_search_pgvector", fake_search_pgvector)
    monkeypatch.setattr(service, "_search_python", fail_python)

    bundle = await service.search(session=None, workspace_id=uuid4(), query="pricing strategy")

    assert bundle.observability.path_used == "pgvector_sql"
    assert bundle.observability.fallback_triggered is False
    assert bundle.observability.candidate_counts == {"pgvector_sql": 6}
    assert bundle.observability.query_embedding_available is True
    assert bundle.observability.query_embedding_provider == "alibaba-compatible"
    assert bundle.observability.reason.startswith("Used pgvector SQL ranking")
    assert "postgres_full_text" in bundle.observability.signals_considered


@pytest.mark.asyncio
async def test_search_observability_reports_python_fallback_when_pgvector_fails(monkeypatch):
    service = KnowledgeService()

    async def fake_embed_query(query: str):
        return [0.4, 0.6], "alibaba-compatible", False

    async def fail_pgvector(*args, **kwargs):
        raise RuntimeError("database operator unavailable")

    async def fake_search_python(session, workspace_id, query, query_vector, filters):
        assert query_vector == [0.4, 0.6]
        assert isinstance(filters, RetrievalFilters)
        return [_search_result("Fallback Memo")], 9

    monkeypatch.setattr(service, "_embed_query", fake_embed_query)
    monkeypatch.setattr(service, "_search_pgvector", fail_pgvector)
    monkeypatch.setattr(service, "_search_python", fake_search_python)

    bundle = await service.search(session=None, workspace_id=uuid4(), query="board memo")

    assert bundle.observability.path_used == "python_hybrid"
    assert bundle.observability.fallback_triggered is True
    assert bundle.observability.fallback_reason == "pgvector_query_failed:RuntimeError"
    assert bundle.observability.attempted_paths == ["pgvector_sql", "python_hybrid"]
    assert bundle.observability.candidate_counts["python_hybrid"] == 9
    assert bundle.observability.reason.startswith("Used Python hybrid ranking because the pgvector SQL path failed")


@pytest.mark.asyncio
async def test_search_observability_reports_skipped_sql_when_embedding_unavailable(monkeypatch):
    service = KnowledgeService()

    async def fail_embed_query(query: str):
        raise TimeoutError("embedding timeout")

    async def fail_pgvector(*args, **kwargs):
        raise AssertionError("pgvector path should not run without a query embedding.")

    async def fake_search_python(session, workspace_id, query, query_vector, filters):
        assert query_vector is None
        assert isinstance(filters, RetrievalFilters)
        return [_search_result("Lexical Memo")], 4

    monkeypatch.setattr(service, "_embed_query", fail_embed_query)
    monkeypatch.setattr(service, "_search_pgvector", fail_pgvector)
    monkeypatch.setattr(service, "_search_python", fake_search_python)

    bundle = await service.search(session=None, workspace_id=uuid4(), query="lexical fallback")

    assert bundle.observability.path_used == "python_hybrid"
    assert bundle.observability.fallback_triggered is False
    assert bundle.observability.fallback_reason == "query_embedding_unavailable:TimeoutError"
    assert bundle.observability.attempted_paths == ["python_hybrid"]
    assert bundle.observability.query_embedding_available is False
    assert bundle.observability.reason.startswith("Used Python hybrid ranking because query embedding generation was unavailable")
