from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from rag_ai.agent.graph_state import AgentGraphState
from rag_ai.agent.workflow import AgentWorkflow, WorkflowCancelled
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
from rag_ai.graph.query_tool import GraphQueryTool
from rag_ai.models.base import ChatMessage, ChatModel
from rag_ai.retrieval.evidence_selector import EvidenceSelector
from rag_ai.retrieval.models import (
    AclSnapshot,
    CitationLocation as DomainCitationLocation,
    RankedChunk,
    RetrievalSummary,
    RetrievalTrace,
    SpacePolicy,
)
from rag_ai.retrieval.service import RetrievalService

logger = logging.getLogger(__name__)


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
    """NDJSON protocol adapter around the LangGraph workflow.

    The graph owns decisions and emits small internal events.  This class alone
    assigns public sequence numbers and maps those events to the stable API
    contract used by the web client.
    """

    def __init__(
        self,
        retrieval: RetrievalService,
        chat: ChatModel,
        *,
        evidence_selector: EvidenceSelector | None = None,
        graph_query: GraphQueryTool | None = None,
        evidence_threshold: float = 0.15,
        max_rewrites: int = 1,
    ) -> None:
        # Retained for the evaluation judge, which shares the configured model
        # but does not enter the retrieval workflow.
        self._chat = chat
        self._workflow = AgentWorkflow(
            retrieval,
            chat,
            evidence_selector=evidence_selector or EvidenceSelector(),
            graph_query=graph_query,
            evidence_threshold=evidence_threshold,
            max_rewrites=max_rewrites,
        )

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
        state = _initial_state(
            request_id, trace_id, actor_id, query, selected_space_ids, acl, policies, history
        )
        seq = 0
        yield RunStarted(
            requestId=request_id, traceId=trace_id, seq=seq,
            occurredAt=datetime.now(timezone.utc), type="run.started",
        )
        seq += 1
        try:
            async for event in self._workflow.astream(state, cancelled):
                if cancelled.is_set():
                    raise WorkflowCancelled()
                mapped = _map_event(event, request_id=request_id, trace_id=trace_id, seq=seq)
                if mapped is not None:
                    yield mapped
                    seq += 1
            if cancelled.is_set():
                raise WorkflowCancelled()
            yield RunCompleted(
                requestId=request_id, traceId=trace_id, seq=seq,
                occurredAt=datetime.now(timezone.utc), type="run.completed", finishReason="stop",
            )
        except WorkflowCancelled:
            yield RunCompleted(
                requestId=request_id, traceId=trace_id, seq=seq,
                occurredAt=datetime.now(timezone.utc), type="run.completed", finishReason="cancelled",
            )
        except Exception as error:
            logger.exception("Agent run failed")
            yield RunFailed(
                requestId=request_id, traceId=trace_id, seq=seq,
                occurredAt=datetime.now(timezone.utc), type="run.failed",
                code="AGENT_RUN_FAILED", message=str(error) or "Agent run failed", retryable=False,
            )

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
        state = await self._workflow.ainvoke(_initial_state(
            request_id, trace_id, actor_id, query, selected_space_ids, acl, policies, []
        ))
        citations = [
            _citation_from_chunk(chunk, request_id=request_id, trace_id=trace_id, seq=index)
            for index, chunk in enumerate(state.get("citation_chunks", []))
        ]
        return AgentResult(
            answer=state.get("answer", ""),
            citations=citations,
            finish_reason=state.get("finish_reason", "stop"),
            summary=state.get("summary"),
            trace=state.get("retrieval_trace"),
            effective_query=state.get("effective_query", query),
            evidence_chunks=list(state.get("evidence_chunks", [])),
        )


def _initial_state(
    request_id: UUID, trace_id: str, actor_id: str, query: str,
    selected_space_ids: list[UUID], acl: AclSnapshot, policies: list[SpacePolicy],
    history: list[ChatMessage],
) -> AgentGraphState:
    return {
        "request_id": request_id,
        "trace_id": trace_id,
        "actor_id": actor_id,
        "query": query,
        "effective_query": query,
        "selected_space_ids": selected_space_ids,
        "acl": acl,
        "policies": policies,
        "history": history,
        "rewrite_count": 0,
        "retrieval_attempt": 0,
        "ranked_chunks": [],
        "graph_evidence": [],
        "evidence_chunks": [],
        "context_evidence": [],
        "citation_chunks": [],
    }


def _map_event(
    event: dict[str, Any], *, request_id: UUID, trace_id: str, seq: int
) -> AgentEvent | None:
    occurred_at = datetime.now(timezone.utc)
    event_type = event["type"]
    if event_type == "status":
        return RunStatus(
            requestId=request_id, traceId=trace_id, seq=seq, occurredAt=occurred_at,
            type="run.status", status=event["status"],
        )
    if event_type == "retrieval":
        return RetrievalSummaryEvent(
            requestId=request_id, traceId=trace_id, seq=seq, occurredAt=occurred_at,
            type="retrieval.summary", summary=_summary_to_event(event["summary"], event["attempt"], event["query"]),
        )
    if event_type == "token":
        return TextDelta(
            requestId=request_id, traceId=trace_id, seq=seq, occurredAt=occurred_at,
            type="text.delta", text=event["text"],
        )
    if event_type == "citation":
        return _citation_from_chunk(event["chunk"], request_id=request_id, trace_id=trace_id, seq=seq)
    return None


def _summary_to_event(summary: RetrievalSummary, attempt: int, query: str) -> dict[str, Any]:
    return {
        "query": query,
        "attempt": attempt,
        "vectorTopK": summary.vector_top_k,
        "lexicalTopK": summary.lexical_top_k,
        "rrfK": summary.rrf_k,
        "rrfTopK": summary.rrf_top_k,
        "rerankTopK": summary.rerank_top_k,
        "rerankerEnabled": summary.reranker_enabled,
        "paths": [
            {
                "path": path.path, "spaceId": str(path.space_id),
                "candidatesReturned": path.candidates_returned,
                **({"candidatesAfterAcl": path.candidates_after_acl} if path.candidates_after_acl is not None else {}),
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


def _citation_from_chunk(
    item: RankedChunk, *, request_id: UUID, trace_id: str, seq: int
) -> Citation:
    chunk = item.chunk
    return Citation(
        requestId=request_id, traceId=trace_id, seq=seq, occurredAt=datetime.now(timezone.utc),
        type="citation", citationId=chunk.chunk_id, chunkId=chunk.chunk_id,
        documentId=chunk.document_id, title=chunk.title, snippet=chunk.content[:300],
        location=_to_event_location(chunk.location),
    )


def _to_event_location(location: DomainCitationLocation) -> CitationLocation:
    fields: dict[str, Any] = {}
    if location.page is not None:
        fields["page"] = location.page
    if location.slide is not None:
        fields["slide"] = location.slide
    if location.sheet is not None:
        fields["sheet"] = location.sheet
    if location.cell_range is not None:
        fields["cellRange"] = location.cell_range
    return CitationLocation(**fields)
