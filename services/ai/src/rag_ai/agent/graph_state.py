from __future__ import annotations

from typing import Literal, TypedDict
from uuid import UUID

from rag_ai.agent.decision import QuestionProfile
from rag_ai.agent.context_builder import ContextEvidence, GraphEvidenceCandidate
from rag_ai.models.base import ChatMessage
from rag_ai.retrieval.models import AclSnapshot, RankedChunk, RetrievalSummary, RetrievalTrace, SpacePolicy


class AgentGraphState(TypedDict, total=False):
    """Data carried by the workflow only; services and callbacks stay outside it."""

    request_id: UUID
    trace_id: str
    actor_id: str
    query: str
    effective_query: str
    selected_space_ids: list[UUID]
    acl: AclSnapshot
    policies: list[SpacePolicy]
    history: list[ChatMessage]
    profile: QuestionProfile
    rewrite_count: int
    retrieval_attempt: int
    ranked_chunks: list[RankedChunk]
    graph_evidence: list[GraphEvidenceCandidate]
    evidence_chunks: list[RankedChunk]
    context_evidence: list[ContextEvidence]
    summary: RetrievalSummary | None
    retrieval_trace: RetrievalTrace | None
    answer: str
    citation_chunks: list[RankedChunk]
    terminal: Literal["answer", "clarify", "refuse"]
    finish_reason: str
