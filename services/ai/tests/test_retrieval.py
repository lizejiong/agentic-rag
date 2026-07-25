from __future__ import annotations

from uuid import UUID, uuid4

import pytest

from rag_ai.models.mock import MockEmbeddingModel, MockReranker
from rag_ai.retrieval.fusion import reciprocal_rank_fusion
from rag_ai.retrieval.models import (
    AclSnapshot,
    CitationLocation,
    RetrievedChunk,
    SpacePolicy,
)
from rag_ai.retrieval.service import RetrievalOptions, RetrievalService


def _chunk(index: int, text: str, space_id: UUID | None = None) -> RetrievedChunk:
    return RetrievedChunk(
        chunk_id=uuid4(),
        document_id=uuid4(),
        version_id=uuid4(),
        space_id=space_id or uuid4(),
        content=text,
        title="doc",
        location=CitationLocation(),
        score=0.0,
        path="vector",
    )


@pytest.mark.asyncio
async def test_mock_embedding_produces_normalized_vectors() -> None:
    model = MockEmbeddingModel(dimensions=16)
    result = await model.embed(["hello world", "hello world"])
    assert len(result.embeddings) == 2
    assert result.embeddings[0] == result.embeddings[1]
    assert abs(sum(x * x for x in result.embeddings[0]) - 1.0) < 1e-6


@pytest.mark.asyncio
async def test_mock_embedding_overlapping_texts_are_similar() -> None:
    model = MockEmbeddingModel(dimensions=32)
    result = await model.embed(["the quick brown fox", "the quick brown dog"])
    a, b = result.embeddings
    similarity = sum(x * y for x, y in zip(a, b))
    assert similarity > 0.0


@pytest.mark.asyncio
async def test_mock_reranker_orders_candidates_by_similarity() -> None:
    reranker = MockReranker(dimensions=32)
    candidates = [
        ("a", "the quick brown fox jumps"),
        ("b", "unrelated quantum physics"),
        ("c", "the quick brown dog runs"),
    ]
    ranked = await reranker.rerank("quick brown animal", candidates, top_k=2)
    assert len(ranked) == 2
    assert ranked[0].chunk_id in {"a", "c"}


def test_rrf_fusion_combines_ranks() -> None:
    vector_a = _chunk(1, "semantic match")
    vector_b = _chunk(2, "another semantic")
    lexical_a = _chunk(3, "keyword match")

    fused = reciprocal_rank_fusion(
        [vector_a, vector_b],
        [lexical_a, vector_a],
        k=60,
        top_k=10,
    )

    ids = [item.chunk_id for item in fused]
    assert vector_a.chunk_id in ids
    assert vector_b.chunk_id in ids
    assert lexical_a.chunk_id in ids
    # vector_a appears in both lists and should have the highest RRF score.
    assert fused[0].chunk_id == vector_a.chunk_id


class FakeVectorRepository:
    def __init__(self, chunks: list[RetrievedChunk]) -> None:
        self._chunks = chunks

    async def search(
        self, query_embedding: list[float], space_ids: list[UUID], acl: AclSnapshot, *, top_k: int
    ) -> list[RetrievedChunk]:
        return [
            chunk
            for chunk in self._chunks
            if chunk.space_id in space_ids and acl.can_read_document(chunk.space_id, {})
        ][:top_k]


class FakeLexicalRepository:
    def __init__(self, chunks: list[RetrievedChunk]) -> None:
        self._chunks = chunks

    async def search(
        self, query: str, space_ids: list[UUID], acl: AclSnapshot, *, top_k: int
    ) -> list[RetrievedChunk]:
        return [
            chunk
            for chunk in self._chunks
            if chunk.space_id in space_ids and acl.can_read_document(chunk.space_id, {})
        ][:top_k]


@pytest.mark.asyncio
async def test_retrieval_service_filters_by_acl() -> None:
    allowed_space = uuid4()
    denied_space = uuid4()
    chunk_allowed = _chunk(1, "allowed content", allowed_space)
    chunk_denied = _chunk(2, "denied content", denied_space)

    service = RetrievalService(
        vector_repo=FakeVectorRepository([chunk_allowed, chunk_denied]),
        lexical_repo=FakeLexicalRepository([chunk_allowed, chunk_denied]),
        embedding_model=MockEmbeddingModel(dimensions=16),
        reranker=MockReranker(dimensions=16),
        options=RetrievalOptions(
            vector_top_k=10,
            lexical_top_k=10,
            rrf_k=60,
            rrf_top_k=10,
            rerank_top_k=5,
        ),
    )

    acl = AclSnapshot(
        user_id=uuid4(),
        admin=False,
        group_ids=[],
        spaces={allowed_space: "VIEW"},
    )
    policies = [SpacePolicy(allowed_space, True, True, True)]
    ranked, summary = await service.retrieve("query", [allowed_space, denied_space], acl, policies)

    returned_ids = {item.chunk.chunk_id for item in ranked}
    assert chunk_allowed.chunk_id in returned_ids
    assert chunk_denied.chunk_id not in returned_ids
    assert summary.paths[0].space_id == allowed_space


@pytest.mark.asyncio
async def test_retrieval_service_skips_vector_when_disabled() -> None:
    space_id = uuid4()
    chunk = _chunk(1, "content", space_id)

    vector_calls: list[bool] = []
    lexical_calls: list[bool] = []

    class CountingVectorRepository(FakeVectorRepository):
        async def search(self, *args, **kwargs):  # noqa: ANN002,ANN003
            vector_calls.append(True)
            return await super().search(*args, **kwargs)

    class CountingLexicalRepository(FakeLexicalRepository):
        async def search(self, *args, **kwargs):  # noqa: ANN002,ANN003
            lexical_calls.append(True)
            return await super().search(*args, **kwargs)

    service = RetrievalService(
        vector_repo=CountingVectorRepository([chunk]),
        lexical_repo=CountingLexicalRepository([chunk]),
        embedding_model=MockEmbeddingModel(dimensions=16),
        reranker=MockReranker(dimensions=16),
        options=RetrievalOptions(),
    )

    acl = AclSnapshot(
        user_id=uuid4(), admin=False, group_ids=[], spaces={space_id: "VIEW"}
    )
    policies = [SpacePolicy(space_id, embedding_enabled=False, reranker_enabled=False, llm_enabled=False)]
    await service.retrieve("query", [space_id], acl, policies)

    assert not vector_calls
    assert lexical_calls
