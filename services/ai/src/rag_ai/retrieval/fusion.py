from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from uuid import UUID

from rag_ai.retrieval.models import RetrievedChunk


@dataclass(frozen=True)
class FusionResult:
    chunk_id: UUID
    rrf_score: float
    vector_rank: int | None
    lexical_rank: int | None
    chunk: RetrievedChunk


def reciprocal_rank_fusion(
    vector_results: list[RetrievedChunk],
    lexical_results: list[RetrievedChunk],
    *,
    k: int = 60,
    top_k: int = 30,
) -> list[FusionResult]:
    scores: dict[UUID, float] = defaultdict(float)
    vector_ranks: dict[UUID, int] = {}
    lexical_ranks: dict[UUID, int] = {}
    chunks: dict[UUID, RetrievedChunk] = {}

    for rank, chunk in enumerate(vector_results, start=1):
        scores[chunk.chunk_id] += 1.0 / (k + rank)
        vector_ranks[chunk.chunk_id] = rank
        chunks[chunk.chunk_id] = chunk

    for rank, chunk in enumerate(lexical_results, start=1):
        scores[chunk.chunk_id] += 1.0 / (k + rank)
        lexical_ranks[chunk.chunk_id] = rank
        chunks[chunk.chunk_id] = chunk

    ordered = sorted(scores.items(), key=lambda item: item[1], reverse=True)
    return [
        FusionResult(
            chunk_id=chunk_id,
            rrf_score=score,
            vector_rank=vector_ranks.get(chunk_id),
            lexical_rank=lexical_ranks.get(chunk_id),
            chunk=chunks[chunk_id],
        )
        for chunk_id, score in ordered[:top_k]
    ]
