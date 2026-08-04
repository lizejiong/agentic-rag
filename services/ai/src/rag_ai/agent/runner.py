from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Literal, TypedDict
from uuid import UUID

from rag_ai.contracts.agent_events import (
    AgentEvent,
    Citation,
    CitationLocation,
    RetrievalSummary as RetrievalSummaryEvent,
    RunCompleted,
    RunFailed,
    RunStarted,
    RunStatus,
    TextDelta,
)
from rag_ai.models.base import ChatMessage, ChatModel
from rag_ai.retrieval.evidence_selector import EvidenceSelector
from rag_ai.retrieval.models import AclSnapshot, CitationLocation as DomainCitationLocation, RankedChunk, RetrievalSummary, RetrievalTrace, SpacePolicy
from rag_ai.retrieval.service import RetrievalService

logger = logging.getLogger(__name__)


@dataclass
class AgentState:
    request_id: UUID
    trace_id: str
    actor_id: str
    query: str
    selected_space_ids: list[UUID]
    acl: AclSnapshot
    policies: list[SpacePolicy]
    history: list[ChatMessage] = field(default_factory=list)

    # Mutable results populated during the run.
    rewritten_query: str | None = None
    rewrite_count: int = 0
    chunks: list[RankedChunk] = field(default_factory=list)
    summary: RetrievalSummary | None = None
    retrieval_trace: RetrievalTrace | None = None
    answer: str = ""
    citations: list[Citation] = field(default_factory=list)
    finish_reason: str = "stop"
    error_code: str | None = None
    error_message: str | None = None


@dataclass(frozen=True)
class AgentResult:
    answer: str
    citations: list[Citation]
    finish_reason: str
    summary: RetrievalSummary | None
    trace: RetrievalTrace | None
    effective_query: str
    evidence_chunks: list[RankedChunk]


class Agent:
    def __init__(
        self,
        retrieval: RetrievalService,
        chat: ChatModel,
        *,
        evidence_selector: EvidenceSelector | None = None,
        evidence_threshold: float = 0.15,
        max_rewrites: int = 1,
    ) -> None:
        self._retrieval = retrieval
        self._chat = chat
        self._evidence_selector = evidence_selector or EvidenceSelector()
        self._evidence_threshold = evidence_threshold
        self._max_rewrites = max_rewrites

    async def run(
        self,
        request_id: UUID,
        trace_id: str,
        actor_id: str,
        query: str,
        selected_space_ids: list[UUID],
        acl: AclSnapshot,
        policies: list[SpacePolicy],
        history: list[ChatMessage],
        cancelled: asyncio.Event,
    ) -> AsyncIterator[AgentEvent]:
        state = AgentState(
            request_id=request_id,
            trace_id=trace_id,
            actor_id=actor_id,
            query=query,
            selected_space_ids=selected_space_ids,
            acl=acl,
            policies=policies,
            history=history,
        )
        seq = 0
        yield RunStarted(
            requestId=request_id,
            traceId=trace_id,
            seq=seq,
            occurredAt=datetime.now(timezone.utc),
            type="run.started",
        )
        seq += 1

        try:
            async for event in self._execute(state, cancelled):
                yield event
                seq += 1
        except _Cancelled:
            yield RunCompleted(
                requestId=request_id,
                traceId=trace_id,
                seq=seq,
                occurredAt=datetime.now(timezone.utc),
                type="run.completed",
                finishReason="cancelled",
            )
            return
        except Exception as error:
            logger.exception("Agent run failed")
            yield RunFailed(
                requestId=request_id,
                traceId=trace_id,
                seq=seq,
                occurredAt=datetime.now(timezone.utc),
                type="run.failed",
                code="AGENT_RUN_FAILED",
                message=str(error) or "Agent run failed",
                retryable=False,
            )
            return

    async def run_evaluation(
        self,
        *,
        request_id: UUID,
        trace_id: str,
        actor_id: str,
        query: str,
        selected_space_ids: list[UUID],
        acl: AclSnapshot,
        policies: list[SpacePolicy],
    ) -> AgentResult:
        """Execute the same Agent path as chat without serialising stream events."""
        state = AgentState(
            request_id=request_id,
            trace_id=trace_id,
            actor_id=actor_id,
            query=query,
            selected_space_ids=selected_space_ids,
            acl=acl,
            policies=policies,
        )
        async for _event in self._execute(state, asyncio.Event()):
            pass
        return AgentResult(
            answer=state.answer,
            citations=state.citations,
            finish_reason=state.finish_reason,
            summary=state.summary,
            trace=state.retrieval_trace,
            effective_query=state.rewritten_query or state.query,
            evidence_chunks=list(state.chunks),
        )
    async def _execute(
        self, state: AgentState, cancelled: asyncio.Event
    ) -> AsyncIterator[AgentEvent]:
        seq = 1  # run.started was seq 0

        def check_cancel() -> None:
            if cancelled.is_set():
                raise _Cancelled()

        check_cancel()
        yield RunStatus(
            requestId=state.request_id,
            traceId=state.trace_id,
            seq=seq,
            occurredAt=datetime.now(timezone.utc),
            type="run.status",
            status="understanding",
        )
        seq += 1

        query = state.query
        effective_history = list(state.history)

        # Retrieval loop with optional rewrite.
        while True:
            check_cancel()
            yield RunStatus(
                requestId=state.request_id,
                traceId=state.trace_id,
                seq=seq,
                occurredAt=datetime.now(timezone.utc),
                type="run.status",
                status="retrieving",
            )
            seq += 1

            ranked, summary = await self._retrieval.retrieve(
                query, state.selected_space_ids, state.acl, state.policies
            )
            state.summary = summary
            state.retrieval_trace = summary.trace
            state.chunks = ranked

            yield RetrievalSummaryEvent(
                requestId=state.request_id,
                traceId=state.trace_id,
                seq=seq,
                occurredAt=datetime.now(timezone.utc),
                type="retrieval.summary",
                summary=_summary_to_event(summary),
            )
            seq += 1

            check_cancel()
            yield RunStatus(
                requestId=state.request_id,
                traceId=state.trace_id,
                seq=seq,
                occurredAt=datetime.now(timezone.utc),
                type="run.status",
                status="ranking",
            )
            seq += 1

            # ── Evidence selection ──
            score_type: Literal["reranker", "rrf"] = (
                "reranker" if summary.reranker_enabled and not summary.reranker_failed
                else "rrf"
            )
            evidence = self._evidence_selector.select(
                ranked,
                score_type=score_type,
                query=query,
                # TODO: pass actual system / history token counts from prompt builder
            )

            sufficient = evidence and self._assess_evidence(evidence)
            if not sufficient and state.rewrite_count < self._max_rewrites:
                state.rewrite_count += 1
                rewritten = await self._rewrite_query(query, ranked, effective_history)
                if rewritten and rewritten != query:
                    state.rewritten_query = rewritten
                    query = rewritten
                    # Re-run with best-effort evidence so the rewriter has context
                    evidence = self._evidence_selector.select(
                        ranked,
                        score_type=score_type,
                        query=query,
                    )
                    continue

            state.chunks = evidence
            break

        check_cancel()
        if not evidence:
            state.finish_reason = "stop"
            state.answer = "根据现有资料无法回答该问题。"
            yield TextDelta(
                requestId=state.request_id,
                traceId=state.trace_id,
                seq=seq,
                occurredAt=datetime.now(timezone.utc),
                type="text.delta",
                text=state.answer,
            )
            seq += 1
            yield RunCompleted(
                requestId=state.request_id,
                traceId=state.trace_id,
                seq=seq,
                occurredAt=datetime.now(timezone.utc),
                type="run.completed",
                finishReason="stop",
            )
            return

        yield RunStatus(
            requestId=state.request_id,
            traceId=state.trace_id,
            seq=seq,
            occurredAt=datetime.now(timezone.utc),
            type="run.status",
            status="answering",
        )
        seq += 1

        llm_enabled = any(policy.llm_enabled for policy in state.policies)
        num_to_id: dict[str, str] = {}
        if llm_enabled:
            prompt, num_to_id = _build_prompt(query, evidence)
            messages = effective_history + [ChatMessage(role="user", content=prompt)]
            answer_parts: list[str] = []
            async for token in self._chat.astream(messages):
                check_cancel()
                answer_parts.append(token)
                yield TextDelta(
                    requestId=state.request_id,
                    traceId=state.trace_id,
                    seq=seq,
                    occurredAt=datetime.now(timezone.utc),
                    type="text.delta",
                    text=token,
                )
                seq += 1
            answer = "".join(answer_parts)
        else:
            answer = _build_fallback_answer(evidence, num_to_id)

        state.answer = answer
        citation_pairs = _extract_numeric_citations(answer)
        # Map numeric citations [1] [2] … back to chunk UUIDs.
        citation_map = [
            (text, num_to_id[num])
            for text, num in citation_pairs
            if num in num_to_id
        ]

        # If the model did not produce citations, attach them from evidence chunks.
        if not citation_map:
            citation_map = [
                (item.chunk.content[:120], str(item.chunk.chunk_id)) for item in evidence[:5]
            ]

        # Emit citation data parts for unique referenced chunks.
        emitted: set[str] = set()
        for _, citation_id in citation_map:
            if citation_id in emitted:
                continue
            emitted.add(citation_id)
            chunk_item = next(
                (item for item in evidence if str(item.chunk.chunk_id) == citation_id), None
            )
            if chunk_item is None:
                continue
            citation = Citation(
                requestId=state.request_id,
                traceId=state.trace_id,
                seq=seq,
                occurredAt=datetime.now(timezone.utc),
                type="citation",
                citationId=UUID(citation_id),
                chunkId=chunk_item.chunk.chunk_id,
                documentId=chunk_item.chunk.document_id,
                title=chunk_item.chunk.title,
                snippet=chunk_item.chunk.content[:300],
                location=_to_event_location(chunk_item.chunk.location),
            )
            state.citations.append(citation)
            yield citation
            seq += 1

        yield RunCompleted(
            requestId=state.request_id,
            traceId=state.trace_id,
            seq=seq,
            occurredAt=datetime.now(timezone.utc),
            type="run.completed",
            finishReason="stop",
        )

    def _assess_evidence(self, evidence: list[RankedChunk]) -> bool:
        if not evidence:
            return False
        # Evidence is sufficient if the top chunk has a meaningful score.
        top_score = evidence[0].rerank_score if evidence[0].rerank_score is not None else evidence[0].rrf_score
        return top_score is not None and top_score >= self._evidence_threshold

    async def _rewrite_query(
        self, query: str, ranked: list[RankedChunk], history: list[ChatMessage]
    ) -> str | None:
        # Minimal deterministic rewrite: expand query with distinct keywords from top chunks.
        keywords: set[str] = set()
        for item in ranked[:3]:
            for word in item.chunk.content.lower().split():
                if len(word) > 3 and word not in query.lower():
                    keywords.add(word)
        if not keywords:
            return None
        return query + " " + " ".join(list(keywords)[:5])


class _Cancelled(Exception):
    pass


def _summary_to_event(summary: RetrievalSummary) -> dict[str, Any]:
    return {
        "query": summary.query,
        "vectorTopK": summary.vector_top_k,
        "lexicalTopK": summary.lexical_top_k,
        "rrfK": summary.rrf_k,
        "rrfTopK": summary.rrf_top_k,
        "rerankTopK": summary.rerank_top_k,
        "rerankerEnabled": summary.reranker_enabled,
        "paths": [
            {
                "path": path.path,
                "spaceId": str(path.space_id),
                "candidatesReturned": path.candidates_returned,
                **(
                    {"candidatesAfterAcl": path.candidates_after_acl}
                    if path.candidates_after_acl is not None
                    else {}
                ),
                **({"error": path.error} if path.error is not None else {}),
            }
            for path in summary.paths
        ],
        "rrfCandidateCount": summary.rrf_candidate_count,
        "finalCandidateCount": summary.final_candidate_count,
        "embeddingModel": summary.embedding_model,
        "embeddingVersion": summary.embedding_version,
        "rerankerModel": summary.reranker_model,
        "rerankerVersion": summary.reranker_version,
        "elapsedMs": summary.elapsed_ms,
    }


def _build_prompt(query: str, evidence: list[RankedChunk]) -> tuple[str, dict[str, str]]:
    """Build the LLM prompt with numbered evidence and return (prompt, num→chunk_id map)."""
    num_to_id: dict[str, str] = {}
    lines = [f"Question: {query}", "", "Evidence:"]
    for index, item in enumerate(evidence, start=1):
        chunk = item.chunk
        num_to_id[str(index)] = str(chunk.chunk_id)
        lines.append(f"[{index}] {chunk.content}")
    lines.extend([
        "",
        "Instructions:",
        "1. Answer the question based ONLY on the evidence above.",
        "2. Summarise and synthesise — do NOT copy-paste raw evidence.",
        "3. Ignore formatting noise: ::: markers, icon: prefixes, layout hints, and similar markup. Extract the underlying facts.",
        "4. Organise the answer in clear Chinese prose. Use bullet points only when listing multiple items.",
        "5. Cite sources with [1] [2] … numbers matching the Evidence above.",
        "6. If the evidence does not contain the answer, say so directly.",
    ])
    return "\n".join(lines), num_to_id


def _build_fallback_answer(
    evidence: list[RankedChunk], num_to_id: dict[str, str]
) -> str:
    sentences: list[str] = []
    for index, item in enumerate(evidence, start=1):
        text = item.chunk.content.rstrip("。，,；;").strip()
        if text:
            sentences.append(f"{text}。[{index}]")
            num_to_id[str(index)] = str(item.chunk.chunk_id)
    if not sentences:
        return "根据现有资料无法回答该问题。"
    return " ".join(sentences)


def _extract_numeric_citations(answer: str) -> list[tuple[str, str]]:
    """Extract (text_before_citation, number) pairs for [1] [2] style citations."""
    import re
    results: list[tuple[str, str]] = []
    # Match [1] through [99] at end of sentences/phrases.
    pattern = re.compile(r"\[(\d{1,2})\](?!\()")
    prev_end = 0
    for match in pattern.finditer(answer):
        num = match.group(1)
        text = answer[prev_end:match.start()].strip()
        if text:
            results.append((text, num))
        prev_end = match.end()
    return results


def _attach_citations(answer: str, citation_map: list[tuple[str, str]]) -> str:
    if answer.endswith("。") or answer.endswith("."):
        answer = answer[:-1]
    snippets = [f"{text}。[{cid}]" for text, cid in citation_map if text]
    return " ".join(snippets) if snippets else answer


class _CitationLocationKwargs(TypedDict, total=False):
    page: int
    slide: int
    sheet: str
    cellRange: str


def _to_event_location(location: DomainCitationLocation) -> CitationLocation:
    fields = _CitationLocationKwargs()
    if location.page is not None:
        fields["page"] = location.page
    if location.slide is not None:
        fields["slide"] = location.slide
    if location.sheet is not None:
        fields["sheet"] = location.sheet
    if location.cell_range is not None:
        fields["cellRange"] = location.cell_range
    return CitationLocation(**fields)
