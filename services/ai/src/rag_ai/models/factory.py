from __future__ import annotations

from rag_ai.models.base import ChatModel, EmbeddingModel, Reranker
from rag_ai.models.mock import MockChatModel, MockEmbeddingModel, MockReranker


def create_embedding_model(
    *, provider: str = "mock", dimensions: int = 384, version: str = "mock-1"
) -> EmbeddingModel:
    if provider == "mock":
        return MockEmbeddingModel(dimensions=dimensions, version=version)
    raise ValueError(f"Unsupported embedding provider: {provider}")


def create_reranker(
    *, provider: str = "mock", dimensions: int = 384, version: str = "mock-1"
) -> Reranker:
    if provider == "mock":
        return MockReranker(dimensions=dimensions, version=version)
    if provider == "none":
        return MockReranker(dimensions=dimensions, version=version)
    raise ValueError(f"Unsupported reranker provider: {provider}")


def create_chat_model(*, provider: str = "mock", version: str = "mock-1") -> ChatModel:
    if provider == "mock":
        return MockChatModel(version=version)
    if provider == "none":
        return MockChatModel(version=version)
    raise ValueError(f"Unsupported chat provider: {provider}")
