from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

import tiktoken

from rag_ai.retrieval.models import RankedChunk


@dataclass(frozen=True)
class GraphEvidenceCandidate:
    """Published graph relation with its original document evidence."""

    relation_id: UUID
    subject: str
    predicate: str
    object_name: str
    confidence: float | None
    evidence: RankedChunk

    @property
    def statement(self) -> str:
        return f"知识图谱关系：{self.subject} {self.predicate} {self.object_name}"


@dataclass(frozen=True)
class ContextEvidence:
    kind: str  # "document" | "graph"
    chunk: RankedChunk
    text: str
    relation_id: UUID | None = None


class ContextBuilder:
    """Build one bounded prompt context from document and graph evidence."""

    def __init__(self, *, max_tokens: int = 4000, max_items: int = 15, model_name: str = "gpt-4o") -> None:
        self._max_tokens = max_tokens
        self._max_items = max_items
        try:
            self._encoding = tiktoken.encoding_for_model(model_name)
        except KeyError:
            self._encoding = tiktoken.get_encoding("cl100k_base")

    def build(
        self,
        document_evidence: list[RankedChunk],
        graph_evidence: list[GraphEvidenceCandidate],
    ) -> list[ContextEvidence]:
        selected: list[ContextEvidence] = []
        used_tokens = 0
        seen_chunks: set[UUID] = set()
        seen_graph: set[tuple[UUID, UUID]] = set()
        candidates: list[ContextEvidence] = []

        # Put the structured relation ahead of its duplicate raw document
        # passage, but account for both kinds under the same prompt budget.
        for graph in graph_evidence:
            graph_key = (graph.relation_id, graph.evidence.chunk.chunk_id)
            if graph_key in seen_graph:
                continue
            seen_graph.add(graph_key)
            candidates.append(ContextEvidence(
                kind="graph", chunk=graph.evidence,
                text=f"{graph.statement}\n来源：{graph.evidence.chunk.content}",
                relation_id=graph.relation_id,
            ))
        candidates.extend(
            ContextEvidence(kind="document", chunk=item, text=item.chunk.content)
            for item in document_evidence
        )

        for candidate in candidates:
            if len(selected) >= self._max_items:
                break
            if candidate.kind == "document" and candidate.chunk.chunk.chunk_id in seen_chunks:
                continue
            token_count = len(self._encoding.encode(self.render(candidate, index=len(selected) + 1)))
            if selected and used_tokens + token_count > self._max_tokens:
                continue
            if token_count > self._max_tokens:
                continue
            selected.append(candidate)
            used_tokens += token_count
            seen_chunks.add(candidate.chunk.chunk.chunk_id)
        return selected

    @staticmethod
    def render(item: ContextEvidence, *, index: int) -> str:
        prefix = "图谱证据" if item.kind == "graph" else "文档证据"
        return f"[{index}] {prefix} | {item.chunk.chunk.title}\n{item.text}"

    @staticmethod
    def has_valid_graph_evidence(graph_evidence: list[GraphEvidenceCandidate]) -> bool:
        return any(candidate.confidence is None or candidate.confidence > 0 for candidate in graph_evidence)
