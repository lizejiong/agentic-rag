from __future__ import annotations

from math import log2


def recall_at_k(retrieved_ids: list[str], relevant_ids: set[str], k: int) -> float:
    if not relevant_ids:
        raise ValueError("relevant_ids must not be empty")
    return len(set(retrieved_ids[:k]) & relevant_ids) / len(relevant_ids)


def ndcg_at_k(retrieved_ids: list[str], relevant_ids: set[str], k: int) -> float:
    if not relevant_ids:
        raise ValueError("relevant_ids must not be empty")
    dcg = sum(
        1 / log2(index + 2)
        for index, chunk_id in enumerate(retrieved_ids[:k])
        if chunk_id in relevant_ids
    )
    ideal_length = min(k, len(relevant_ids))
    ideal_dcg = sum(1 / log2(index + 2) for index in range(ideal_length))
    return dcg / ideal_dcg if ideal_dcg else 0.0


def citation_precision(citation_ids: list[str], supported_ids: set[str]) -> float:
    if not citation_ids:
        return 0.0
    return sum(citation_id in supported_ids for citation_id in citation_ids) / len(citation_ids)
