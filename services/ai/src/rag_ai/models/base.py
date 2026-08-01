from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any



@dataclass(frozen=True)
class EmbedResult:
    texts: list[str]
    embeddings: list[list[float]]
    model: str
    version: str
    dimensions: int


class EmbeddingModel(ABC):
    @abstractmethod
    async def embed(self, texts: list[str]) -> EmbedResult: ...

    @property
    @abstractmethod
    def dimensions(self) -> int: ...

    @property
    @abstractmethod
    def model_name(self) -> str: ...

    @property
    @abstractmethod
    def version(self) -> str: ...


@dataclass(frozen=True)
class RankedCandidate:
    chunk_id: str
    score: float
    details: dict[str, Any]


class Reranker(ABC):
    @abstractmethod
    async def rerank(
        self, query: str, candidates: list[tuple[str, str]], *, top_k: int
    ) -> list[RankedCandidate]: ...

    @property
    @abstractmethod
    def model_name(self) -> str: ...

    @property
    @abstractmethod
    def version(self) -> str: ...


@dataclass(frozen=True)
class ChatMessage:
    role: str
    content: str


@dataclass(frozen=True)
class ChatResponse:
    content: str
    usage: dict[str, int] | None = None


class ChatModel(ABC):
    @abstractmethod
    async def achat(
        self,
        messages: list[ChatMessage],
        *,
        temperature: float = 0.3,
        max_tokens: int = 2048,
        stop: list[str] | None = None,
    ) -> ChatResponse: ...

    async def astream(
        self,
        messages: list[ChatMessage],
        *,
        temperature: float = 0.3,
        max_tokens: int = 2048,
        stop: list[str] | None = None,
    ) -> AsyncIterator[str]:
        """Stream response tokens.  Defaults to char-by-char over ``achat``."""
        response = await self.achat(
            messages, temperature=temperature, max_tokens=max_tokens, stop=stop
        )
        for char in response.content:
            yield char

    @property
    @abstractmethod
    def model_name(self) -> str: ...

    @property
    @abstractmethod
    def version(self) -> str: ...
