from __future__ import annotations

import json

import httpx
import pytest

from rag_ai.models.http_reranker import HttpReranker


@pytest.mark.asyncio
async def test_rerank_maps_indexes_to_chunk_ids_siliconflow() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["authorization"] == "Bearer test-key"
        assert json.loads(request.content) == {
            "model": "BAAI/bge-reranker-v2-m3",
            "query": "什么是 RAG？",
            "documents": ["无关内容", "RAG 会检索知识库内容"],
            "top_n": 2,
            "return_documents": False,
        }
        return httpx.Response(
            200,
            json={
                "results": [
                    {"index": 1, "relevance_score": 0.9},
                    {"index": 0, "relevance_score": 0.1},
                ]
            },
        )

    reranker = HttpReranker(
        provider="siliconflow",
        api_key="test-key",
        base_url="https://api.siliconflow.cn/v1/rerank",
        model="BAAI/bge-reranker-v2-m3",
        transport=httpx.MockTransport(handler),
    )

    ranked = await reranker.rerank(
        "什么是 RAG？",
        [("first", "无关内容"), ("second", "RAG 会检索知识库内容")],
        top_k=2,
    )

    assert [(item.chunk_id, item.score) for item in ranked] == [
        ("second", 0.9),
        ("first", 0.1),
    ]


@pytest.mark.asyncio
async def test_rerank_includes_optional_instruction_siliconflow() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert json.loads(request.content)["instruction"] == "Prefer exact answers."
        return httpx.Response(200, json={"results": []})

    reranker = HttpReranker(
        provider="siliconflow",
        api_key="test-key",
        base_url="https://api.siliconflow.cn/v1/rerank",
        model="Qwen/Qwen3-Reranker-8B",
        instruction="Prefer exact answers.",
        transport=httpx.MockTransport(handler),
    )

    assert await reranker.rerank("query", [("first", "content")], top_k=1) == []


@pytest.mark.asyncio
async def test_rerank_maps_indexes_to_chunk_ids_bailian() -> None:
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

    reranker = HttpReranker(
        provider="bailian",
        api_key="test-key",
        base_url="https://example.test/compatible-api/v1/reranks",
        model="qwen3-rerank",
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
