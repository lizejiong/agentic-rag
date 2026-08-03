from __future__ import annotations

from rag_ai.models.base import ChatModel, EmbeddingModel, Reranker
from rag_ai.models.http_reranker import HttpReranker
from rag_ai.models.mock import MockChatModel, MockEmbeddingModel, MockReranker
from rag_ai.models.openai_model import OpenAIEmbeddingModel, OpenAIChatModel


def create_embedding_model(
    *,
    provider: str = "mock",
    dimensions: int = 384,
    version: str = "mock-1",
    api_key: str = "",
    base_url: str = "",
) -> EmbeddingModel:
    if provider == "mock":
        return MockEmbeddingModel(dimensions=dimensions, version=version)
    if provider == "openai":
        return OpenAIEmbeddingModel(
            api_key=api_key,
            model=version,
            dimensions=dimensions,
            base_url=base_url or None,
        )
    raise ValueError(f"Unsupported embedding provider: {provider}")


def create_reranker(
    *,
    provider: str = "mock",
    dimensions: int = 384,
    version: str = "mock-1",
    api_key: str = "",
    base_url: str = "",
    timeout_seconds: float = 15.0,
    instruct: str = "Given a web search query, retrieve relevant passages that answer the query.",
) -> Reranker:
    if provider == "mock":
        return MockReranker(dimensions=dimensions, version=version)
    if provider == "none":
        return MockReranker(dimensions=dimensions, version=version)
    if provider == "bailian":
        if not api_key:
            raise ValueError("RERANKER_API_KEY is required when RERANKER_PROVIDER=bailian")
        if not base_url:
            raise ValueError("RERANKER_BASE_URL is required when RERANKER_PROVIDER=bailian")
        return HttpReranker(
            provider="bailian",
            api_key=api_key,
            base_url=base_url,
            model=version,
            timeout_seconds=timeout_seconds,
            instruction=instruct,
        )
    if provider == "siliconflow":
        if not api_key:
            raise ValueError("RERANKER_API_KEY is required when RERANKER_PROVIDER=siliconflow")
        return HttpReranker(
            provider="siliconflow",
            api_key=api_key,
            base_url=base_url or "https://api.siliconflow.cn/v1/rerank",
            model=version,
            timeout_seconds=timeout_seconds,
            instruction=instruct if version.startswith("Qwen/Qwen3-Reranker-") else None,
        )
    raise ValueError(f"Unsupported reranker provider: {provider}")


def create_chat_model(
    *,
    provider: str = "mock",
    version: str = "mock-1",
    api_key: str = "",
    base_url: str = "",
) -> ChatModel:
    if provider == "mock":
        return MockChatModel(version=version)
    if provider == "none":
        return MockChatModel(version=version)
    if provider == "openai":
        return OpenAIChatModel(api_key=api_key, model=version, base_url=base_url or None)
    raise ValueError(f"Unsupported chat provider: {provider}")
