from __future__ import annotations

import math
import re
from collections import Counter
from dataclasses import asdict, dataclass, field
from datetime import datetime
from uuid import UUID

from app.core.config import get_settings

settings = get_settings()
TOKEN_PATTERN = re.compile(r"[a-zA-Z0-9]{2,}")


@dataclass
class RetrievalScore:
    keyword_score: float
    vector_score: float
    combined_score: float
    overlap_terms: list[str]


@dataclass
class RetrievalFilters:
    source_types: list[str] = field(default_factory=list)
    tags: list[str] = field(default_factory=list)
    document_ids: list[UUID] = field(default_factory=list)
    created_after: datetime | None = None
    created_before: datetime | None = None
    min_trust_score: float | None = None
    include_duplicates: bool = False
    limit: int | None = None

    def normalized_limit(self) -> int:
        requested = self.limit or settings.retrieval_default_limit
        return max(1, min(requested, settings.retrieval_max_candidates))

    def to_dict(self) -> dict:
        return {
            "source_types": list(self.source_types),
            "tags": list(self.tags),
            "document_ids": [str(value) for value in self.document_ids],
            "created_after": self.created_after.isoformat() if self.created_after else None,
            "created_before": self.created_before.isoformat() if self.created_before else None,
            "min_trust_score": self.min_trust_score,
            "include_duplicates": self.include_duplicates,
            "limit": self.normalized_limit(),
        }


@dataclass
class RetrievalObservability:
    path_used: str
    attempted_paths: list[str] = field(default_factory=list)
    reason: str = ""
    fallback_triggered: bool = False
    fallback_reason: str | None = None
    query_embedding_available: bool = False
    query_embedding_dimensions: int | None = None
    query_embedding_provider: str | None = None
    query_embedding_fallback: bool = False
    candidate_limit: int = 0
    candidate_counts: dict[str, int] = field(default_factory=dict)
    returned_count: int = 0
    signals_considered: list[str] = field(default_factory=list)
    weights: dict[str, float] = field(default_factory=dict)
    timings_ms: dict[str, float] = field(default_factory=dict)
    notes: list[str] = field(default_factory=list)
    filters_applied: dict = field(default_factory=dict)
    max_chunks_per_document: int = 0
    rerank_strategy: str = ""

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class RetrievalSearchBundle:
    results: list[dict]
    observability: RetrievalObservability


def normalize_tag(value: str) -> str:
    return value.strip().lower().replace(" ", "-")


def tokenize(text: str) -> list[str]:
    return [match.group(0).lower() for match in TOKEN_PATTERN.finditer(text)]


def keyword_score(query: str, candidate: str) -> tuple[float, list[str]]:
    query_tokens = tokenize(query)
    candidate_tokens = tokenize(candidate)
    if not query_tokens or not candidate_tokens:
        return 0.0, []

    candidate_counts = Counter(candidate_tokens)
    matched = sorted({token for token in query_tokens if token in candidate_counts})
    term_hits = sum(candidate_counts[token] for token in set(query_tokens))
    normalized = min(term_hits / max(len(set(query_tokens)), 1), 1.0)

    phrase_bonus = 0.18 if query.lower() in candidate.lower() else 0.0
    density_bonus = min(len(matched) / max(len(set(query_tokens)), 1), 1.0) * 0.22
    score = min(normalized * 0.6 + density_bonus + phrase_bonus, 1.0)
    return score, matched


def cosine_similarity(left: list[float] | None, right: list[float] | None) -> float:
    if not left or not right or len(left) != len(right):
        return 0.0
    dot = sum(a * b for a, b in zip(left, right))
    left_norm = math.sqrt(sum(a * a for a in left))
    right_norm = math.sqrt(sum(b * b for b in right))
    if left_norm == 0 or right_norm == 0:
        return 0.0
    similarity = dot / (left_norm * right_norm)
    return max(min((similarity + 1.0) / 2.0, 1.0), 0.0)


def hybrid_score(
    query: str,
    query_vector: list[float] | None,
    candidate_text: str,
    candidate_vector: list[float] | None,
) -> RetrievalScore:
    lexical, overlap_terms = keyword_score(query, candidate_text)
    semantic = cosine_similarity(query_vector, candidate_vector)
    combined = (
        lexical * settings.retrieval_keyword_weight
        + semantic * settings.retrieval_vector_weight
    )
    return RetrievalScore(
        keyword_score=round(lexical, 4),
        vector_score=round(semantic, 4),
        combined_score=round(combined, 4),
        overlap_terms=overlap_terms,
    )


def rerank_score(base_score: float, trust_score: float, freshness_score: float) -> float:
    reranked = (
        base_score
        + trust_score * settings.retrieval_trust_weight
        + freshness_score * settings.retrieval_freshness_weight
    )
    return round(max(reranked, 0.0), 4)


def serialize_fallback_reason(code: str, exc: Exception | None = None) -> str:
    if exc is None:
        return code
    return f"{code}:{exc.__class__.__name__}"


def describe_search_path(
    path_used: str,
    *,
    query_embedding_available: bool,
    fallback_reason: str | None = None,
    fallback_triggered: bool = False,
) -> str:
    if path_used == "pgvector_sql":
        return (
            "Used pgvector SQL ranking because a query embedding was available, PostgreSQL "
            "returned weighted lexical and vector matches, and the application reranked them "
            "with trust and freshness signals."
        )

    if fallback_reason == "pgvector_returned_no_ranked_matches":
        return (
            "Used Python hybrid ranking because the pgvector SQL path returned no positive-score "
            "matches after retrieval and reranking."
        )

    if fallback_reason and fallback_reason.startswith("pgvector_query_failed"):
        return (
            "Used Python hybrid ranking because the pgvector SQL path failed, so the application "
            "scorer took over and reranked results with trust and freshness signals."
        )

    if fallback_reason and fallback_reason.startswith("query_embedding_unavailable"):
        return (
            "Used Python hybrid ranking because query embedding generation was unavailable, so "
            "the SQL vector path was skipped."
        )

    if fallback_triggered:
        return "Used Python hybrid ranking after the primary ranking path did not complete cleanly."

    if not query_embedding_available:
        return "Used Python hybrid ranking with lexical signals because no query embedding was available."

    return "Used Python hybrid ranking as the active retrieval path for this search."


def signals_for_search_path(path_used: str, *, query_embedding_available: bool) -> list[str]:
    base = ["source_trust", "document_freshness", "per_document_diversity_cap"]
    if path_used == "pgvector_sql":
        return [
            "postgres_full_text",
            "pgvector_cosine_distance",
            "weighted_hybrid_rank",
            *base,
        ]

    if query_embedding_available:
        return ["keyword_overlap", "python_cosine_similarity", "weighted_hybrid_rank", *base]

    return ["keyword_overlap", "weighted_hybrid_rank", *base]
