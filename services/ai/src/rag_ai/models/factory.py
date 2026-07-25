from __future__ import annotations

import os

from rag_ai.models.base import ChatModel, EmbeddingModel, Reranker
from rag_ai.models.mock import MockChatModel, MockEmbeddingModel, MockReranker
from rag_ai.models.openai_model import OpenAIEmbeddingModel, OpenAIChatModel


def create_embedding_model(
    *,
    provider: str = "mock",
    dimensions: int = 384,
    version: str = "mock-1",
    api_key: str | None = None,
    base_url: str | None = None,
) -> EmbeddingModel:
    key = api_key or os.environ.get("OPENAI_API_KEY", "")
    url = base_url or os.environ.get("OPENAI_BASE_URL", None)
    if provider == "mock":
        return MockEmbeddingModel(dimensions=dimensions, version=version)
    if provider == "openai":
        return OpenAIEmbeddingModel(
            api_key=key,
            model=version,
            dimensions=dimensions,
            base_url=url,
        )
    raise ValueError(f"Unsupported embedding provider: {provider}")


def create_reranker(
    *,
    provider: str = "mock",
    dimensions: int = 384,
    version: str = "mock-1",
) -> Reranker:
    if provider == "mock":
        return MockReranker(dimensions=dimensions, version=version)
    if provider == "none":
        return MockReranker(dimensions=dimensions, version=version)
    raise ValueError(f"Unsupported reranker provider: {provider}")


def create_chat_model(
    *,
    provider: str = "mock",
    version: str = "mock-1",
    api_key: str | None = None,
    base_url: str | None = None,
) -> ChatModel:
    key = api_key or os.environ.get("OPENAI_API_KEY", "")
    url = base_url or os.environ.get("OPENAI_BASE_URL", None)
    if provider == "mock":
        return MockChatModel(version=version)
    if provider == "none":
        return MockChatModel(version=version)
    if provider == "openai":
        return OpenAIChatModel(api_key=key, model=version, base_url=url)
    raise ValueError(f"Unsupported chat provider: {provider}")
