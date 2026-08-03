from __future__ import annotations

import dataclasses
import unicodedata
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Literal
from uuid import UUID

import tiktoken

from rag_ai.retrieval.models import RankedChunk


# Minimum tokens needed to render a single evidence item (citation number,
# brackets, newlines).  Below this the evidence budget is considered exhausted.
_CITATION_FRAME_TOKENS = 8


@dataclass
class EvidenceSelector:
    """Score-aware, token-budgeted evidence selection for LLM prompt assembly.

    The selector is a pure filter—it decides *which* chunks enter the prompt
    but does not judge whether the evidence is sufficient to answer the
    question.  That judgment stays with ``Agent._assess_evidence``.
    """

    # ═══════════════════════════════════════════════════════════════════
    #  Score filtering
    # ═══════════════════════════════════════════════════════════════════

    rerank_min_score: float = 0.1
    rrf_min_score: float = 0.0        # RRF doesn't use absolute thresholds by default

    # ═══════════════════════════════════════════════════════════════════
    #  Cliff detection (disabled by default)
    # ═══════════════════════════════════════════════════════════════════

    rerank_max_relative_drop: float = 0.0
    rerank_absolute_drop: float = 0.15
    rrf_max_relative_drop: float = 0.0
    rrf_absolute_drop: float = 0.003
    cliff_min_chunks: int = 3

    # ═══════════════════════════════════════════════════════════════════
    #  Token budget
    # ═══════════════════════════════════════════════════════════════════

    model_name: str = "gpt-4o"
    fallback_encoding: str = "cl100k_base"
    max_evidence_tokens: int = 4000
    max_chunk_tokens: int = 600
    output_reservation: int = 2048
    max_evidence_chunks: int = 15

    # ═══════════════════════════════════════════════════════════════════
    #  Diversity
    # ═══════════════════════════════════════════════════════════════════

    max_chunks_per_doc: int = 2
    jaccard_similarity_threshold: float | None = None

    # ═══════════════════════════════════════════════════════════════════
    #  Internal
    # ═══════════════════════════════════════════════════════════════════

    _encoding: tiktoken.Encoding = field(init=False, repr=False)

    def __post_init__(self) -> None:
        try:
            self._encoding = tiktoken.encoding_for_model(self.model_name)
        except KeyError:
            self._encoding = tiktoken.get_encoding(self.fallback_encoding)

    # ==================================================================
    #  Public API
    # ==================================================================

    def select(
        self,
        ranked: list[RankedChunk],
        *,
        score_type: Literal["reranker", "rrf"],
        query: str = "",
        system_tokens: int = 0,
        history_tokens: int = 0,
        model_max_input: int = 8000,
    ) -> list[RankedChunk]:
        """Return the subset of *ranked* that should be placed in the LLM prompt.

        May return an empty list when no chunk meets the minimum criteria.
        """
        if not ranked:
            return []

        candidates = self._apply_threshold(ranked, score_type)
        if not candidates:
            return []

        cliff = self._detect_cliff(candidates, score_type)
        if cliff is not None:
            candidates = candidates[:cliff]

        budget = self._compute_budget(
            query, system_tokens, history_tokens, model_max_input
        )
        return self._fill_by_budget(candidates, budget)

    # ==================================================================
    #  Rendering (shared between token counting and prompt building)
    # ==================================================================

    @staticmethod
    def render_evidence_item(chunk: RankedChunk, *, index: int) -> str:
        """Render a single evidence item with its citation number.

        This is the canonical format used both for token estimation *and*
        for the final LLM prompt.  Keep the two in sync.
        """
        title = chunk.chunk.title or ""
        content = chunk.chunk.content or ""
        return f"[{index}] {title}\n{content}"

    # ==================================================================
    #  ①  Hard threshold
    # ==================================================================

    def _apply_threshold(
        self, ranked: list[RankedChunk], score_type: str
    ) -> list[RankedChunk]:
        if score_type == "reranker":
            if not all(c.rerank_score is not None for c in ranked):
                raise ValueError(
                    "score_type='reranker' but some chunks lack rerank_score"
                )
            return [c for c in ranked if (c.rerank_score or 0) >= self.rerank_min_score]
        else:
            if self.rrf_min_score > 0:
                return [c for c in ranked if (c.rrf_score or 0) >= self.rrf_min_score]
            return list(ranked)

    # ==================================================================
    #  ②  Cliff detection
    # ==================================================================

    def _detect_cliff(
        self, candidates: list[RankedChunk], score_type: str
    ) -> int | None:
        if score_type == "reranker":
            relative = self.rerank_max_relative_drop
            absolute = self.rerank_absolute_drop
        else:
            relative = self.rrf_max_relative_drop
            absolute = self.rrf_absolute_drop

        if relative <= 0:
            return None

        if len(candidates) <= self.cliff_min_chunks:
            return None

        for i in range(self.cliff_min_chunks, len(candidates)):
            prev = self._extract_score(candidates[i - 1], score_type)
            curr = self._extract_score(candidates[i], score_type)
            if prev > 0 and curr / prev < (1 - relative) and (prev - curr) > absolute:
                return i
        return None

    # ==================================================================
    #  ③  Token budget
    # ==================================================================

    def _compute_budget(
        self, query: str, system_tokens: int, history_tokens: int, model_max_input: int
    ) -> int:
        query_tokens = len(self._encoding.encode(query))
        available = (
            model_max_input
            - system_tokens
            - history_tokens
            - self.output_reservation
            - query_tokens
        )
        return min(self.max_evidence_tokens, max(0, available))

    # ==================================================================
    #  ④  Budget-filling loop with diversity
    # ==================================================================

    def _fill_by_budget(
        self, candidates: list[RankedChunk], budget: int
    ) -> list[RankedChunk]:
        if budget < _CITATION_FRAME_TOKENS:
            return []

        selected: list[RankedChunk] = []
        used: int = 0
        seen_doc: dict[UUID, int] = defaultdict(int)

        for chunk in candidates:
            if len(selected) >= self.max_evidence_chunks:
                break

            remaining = budget - used

            # ── Per-document limit ──
            doc_id = chunk.chunk.document_id
            if seen_doc[doc_id] >= self.max_chunks_per_doc:
                continue

            # ── Jaccard dedup (character 2-gram, last 3 only) ──
            if self.jaccard_similarity_threshold is not None and selected:
                if any(
                    self._jaccard_2gram(chunk, prev)
                    >= self.jaccard_similarity_threshold
                    for prev in selected[-3:]
                ):
                    continue

            # ── 算 metadata 开销 ──
            frame = EvidenceSelector.render_evidence_item(
                EvidenceSelector._stub_chunk(chunk, content=""), index=len(selected) + 1
            )
            frame_tokens = len(self._encoding.encode(frame))
            content_budget = min(self.max_chunk_tokens, remaining - frame_tokens)
            if content_budget <= 0:
                continue       # 放不下正文，试下一条更短的

            content = chunk.chunk.content or ""
            content_tokens = len(self._encoding.encode(content))

            if content_tokens > content_budget:
                content = self._truncate_to_tokens(content, content_budget)
                chunk = dataclasses.replace(
                    chunk,
                    chunk=dataclasses.replace(chunk.chunk, content=content),
                )

            rendered = EvidenceSelector.render_evidence_item(
                chunk, index=len(selected) + 1
            )
            tokens = len(self._encoding.encode(rendered))

            if selected and used + tokens > budget:
                continue       # 放不下，试下一条

            selected.append(chunk)
            seen_doc[doc_id] += 1
            used += tokens

        return selected

    # ==================================================================
    #  Helpers
    # ==================================================================

    @staticmethod
    def _extract_score(item: RankedChunk, score_type: str) -> float:
        if score_type == "reranker":
            return item.rerank_score or 0
        return item.rrf_score or 0

    def _truncate_to_tokens(self, text: str, max_tokens: int) -> str:
        if max_tokens <= 0:
            return ""
        tokens = self._encoding.encode(text)
        if len(tokens) <= max_tokens:
            return text
        raw = self._encoding.decode(tokens[:max_tokens])
        return unicodedata.normalize("NFC", raw) + "…"

    @staticmethod
    def _jaccard_2gram(a: RankedChunk, b: RankedChunk) -> float:
        def grams(text: str) -> set[str]:
            s = text.strip()
            if not s:
                return set()
            return {s[i : i + 2] for i in range(len(s) - 1)}

        a_set = grams(a.chunk.content)
        b_set = grams(b.chunk.content)
        if not a_set or not b_set:
            return 0.0
        return len(a_set & b_set) / len(a_set | b_set)


    @staticmethod
    def _stub_chunk(original: RankedChunk, *, content: str) -> RankedChunk:
        """Return a shallow copy of *original* with ``chunk.content`` replaced."""
        return dataclasses.replace(
            original, chunk=dataclasses.replace(original.chunk, content=content)
        )
