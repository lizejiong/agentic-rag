from __future__ import annotations

import json

import httpx
import pytest

from rag_ai.models.bailian import BailianReranker


@pytest.mark.asyncio
async def test_bailian_reranker_maps_ranked_indexes_to_chunk_ids() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["authorization"] == "Bearer test-key"
        assert request.url == httpx.URL("https://example.test/compatible-api/v1/reranks")
        assert json.loads(request.content) == {
            "model": "qwen3-rerank",
            "query": "what is RAG?",
            "documents": ["unrelated", "RAG uses retrieved context"],
            "top_n": 2,
            "instruct": "Given a web search query, retrieve relevant passages that answer the query.",
        }
        return httpx.Response(
            200,
            json={
                "results": [
                    {"index": 1, "relevance_score": 0.92},
                    {"index": 0, "relevance_score": 0.08},
                ]
            },
        )

    reranker = BailianReranker(
        api_key="test-key",
        base_url="https://example.test/compatible-api/v1/reranks",
        transport=httpx.MockTransport(handler),
    )

    ranked = await reranker.rerank(
        "what is RAG?",
        [("first", "unrelated"), ("second", "RAG uses retrieved context")],
        top_k=2,
    )

    assert [(item.chunk_id, item.score) for item in ranked] == [
        ("second", 0.92),
        ("first", 0.08),
    ]
