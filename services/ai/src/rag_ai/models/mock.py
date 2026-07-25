from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass

import numpy as np

from rag_ai.models.base import (
    ChatMessage,
    ChatModel,
    ChatResponse,
    EmbedResult,
    EmbeddingModel,
    RankedCandidate,
    Reranker,
)


class MockEmbeddingModel(EmbeddingModel):
    """Deterministic, word-overlap based embedding for tests and offline dev.

    Identical or lexically overlapping texts produce similar normalized vectors.
    This is not a semantic model, but it exercises the full retrieval pipeline
    without cloud credentials or heavy local models.
    """

    def __init__(self, dimensions: int = 384, version: str = "mock-1") -> None:
        self._dimensions = dimensions
        self._version = version

    @property
    def dimensions(self) -> int:
        return self._dimensions

    @property
    def model_name(self) -> str:
        return "mock-embedding"

    @property
    def version(self) -> str:
        return self._version

    async def embed(self, texts: list[str]) -> EmbedResult:
        embeddings = [_text_to_vector(text, self._dimensions) for text in texts]
        return EmbedResult(
            texts=texts,
            embeddings=[vector.tolist() for vector in embeddings],
            model=self.model_name,
            version=self.version,
            dimensions=self.dimensions,
        )


class MockReranker(Reranker):
    """Reranker that falls back to cosine similarity of deterministic vectors.

    Real rerankers can be swapped in via the Reranker interface without changing
    callers.
    """

    def __init__(self, dimensions: int = 384, version: str = "mock-1") -> None:
        self._dimensions = dimensions
        self._version = version

    @property
    def model_name(self) -> str:
        return "mock-reranker"

    @property
    def version(self) -> str:
        return self._version

    async def rerank(
        self, query: str, candidates: list[tuple[str, str]], *, top_k: int
    ) -> list[RankedCandidate]:
        query_vector = _text_to_vector(query, self._dimensions)
        scored: list[tuple[str, float]] = []
        for chunk_id, text in candidates:
            candidate_vector = _text_to_vector(text, self._dimensions)
            similarity = float(np.dot(query_vector, candidate_vector))
            scored.append((chunk_id, similarity))
        scored.sort(key=lambda item: item[1], reverse=True)
        return [
            RankedCandidate(
                chunk_id=chunk_id,
                score=score,
                details={"source": "mock_cosine"},
            )
            for chunk_id, score in scored[:top_k]
        ]


@dataclass(frozen=True)
class _Sentence:
    text: str
    citations: list[str]


class MockChatModel(ChatModel):
    """Rule-based answer generator that stitches retrieved snippets.

    When LLM_PROVIDER is not configured, the system still returns a grounded
    response with citations instead of failing or hallucinating.
    """

    def __init__(self, version: str = "mock-1") -> None:
        self._version = version

    @property
    def model_name(self) -> str:
        return "mock-chat"

    @property
    def version(self) -> str:
        return self._version

    async def achat(
        self,
        messages: list[ChatMessage],
        *,
        temperature: float = 0.3,
        max_tokens: int = 2048,
        stop: list[str] | None = None,
    ) -> ChatResponse:
        # The last user message is assumed to carry the retrieval context in a
        # structured prompt produced by the Agent.
        last_user = next(
            (message.content for message in reversed(messages) if message.role == "user"),
            "",
        )
        answer = _generate_from_context(last_user)
        return ChatResponse(content=answer, usage={"prompt_tokens": 0, "completion_tokens": 0})


def _text_to_vector(text: str, dimensions: int) -> np.ndarray:
    vector = np.zeros(dimensions, dtype=np.float32)
    tokens = re.findall(r"\w+", text.lower())
    if not tokens:
        # Return a deterministic non-zero vector for empty text so cosine is defined.
        seed = hashlib.sha256(text.encode("utf-8")).digest()
        vector = np.frombuffer(seed, dtype=np.uint8)[:dimensions].astype(np.float32)
        vector = vector - 128.0
    else:
        for token in tokens:
            digest = hashlib.sha256(token.encode("utf-8")).digest()
            for index in range(dimensions):
                byte = digest[index % len(digest)]
                # Map byte to a small signed contribution so overlapping tokens
                # reinforce each other.
                vector[index] += (byte / 255.0) * 2.0 - 1.0
    norm = float(np.linalg.norm(vector))
    if norm > 0:
        vector = vector / norm
    return vector


def _generate_from_context(prompt_text: str) -> str:
    """Extract citations and snippets from the Agent's structured prompt.

    Expected format:
        Question: ...
        Evidence:
        [citation_id] snippet text
        [citation_id] snippet text
    """
    evidence: list[tuple[str, str]] = []
    in_evidence = False
    current_citation: str | None = None
    current_snippet: list[str] = []

    for raw_line in prompt_text.splitlines():
        line = raw_line.strip()
        if line.startswith("Evidence:"):
            in_evidence = True
            continue
        if not in_evidence or not line:
            continue
        if line.startswith("[") and "]" in line:
            if current_citation is not None:
                evidence.append((current_citation, " ".join(current_snippet).strip()))
            citation, _, rest = line.partition("]")
            current_citation = citation[1:]
            current_snippet = [rest.strip()]
        elif current_citation is not None:
            current_snippet.append(line)

    if current_citation is not None:
        evidence.append((current_citation, " ".join(current_snippet).strip()))

    if not evidence:
        return "根据现有资料无法回答该问题。"

    sentences: list[str] = []
    for citation_id, snippet in evidence[:5]:
        cleaned = snippet.rstrip("。，,；;").strip()
        if cleaned:
            sentences.append(f"{cleaned}。[{citation_id}]")
    if not sentences:
        return "根据现有资料无法回答该问题。"

    return " ".join(sentences)
