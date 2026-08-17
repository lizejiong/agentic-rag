from __future__ import annotations

import asyncio
import logging
import re
from collections.abc import AsyncGenerator, AsyncIterator, Awaitable
from dataclasses import dataclass
from typing import Any, Literal, cast

from langgraph.config import get_stream_writer
from langgraph.graph import END, START, StateGraph
from langgraph.runtime import Runtime

from rag_ai.agent.context_builder import ContextBuilder, ContextEvidence, GraphEvidenceCandidate
from rag_ai.agent.conversation import resolve_retrieval_query
from rag_ai.agent.decision import QuestionProfile, classify_question
from rag_ai.agent.graph_state import AgentGraphState
from rag_ai.graph.query_tool import GraphQueryTool
from rag_ai.models.base import ChatMessage, ChatModel
from rag_ai.retrieval.evidence_selector import EvidenceSelector
from rag_ai.retrieval.models import RankedChunk, RetrievalSummary
from rag_ai.retrieval.service import RetrievalService

logger = logging.getLogger(__name__)


class WorkflowCancelled(Exception):
    """The per-run cancellation signal won the race with a node operation."""


@dataclass(frozen=True)
class WorkflowRuntimeContext:
    cancelled: asyncio.Event


class AgentWorkflow:
    """The LangGraph implementation of the bounded retrieval-answer loop."""

    def __init__(
        self,
        retrieval: RetrievalService,
        chat: ChatModel,
        *,
        evidence_selector: EvidenceSelector,
        graph_query: GraphQueryTool | None,
        context_builder: ContextBuilder | None = None,
        evidence_threshold: float = 0.15,
        max_rewrites: int = 1,
    ) -> None:
        self._retrieval = retrieval
        self._chat = chat
        self._evidence_selector = evidence_selector
        self._graph_query = graph_query
        self._context_builder = context_builder or ContextBuilder(
            max_tokens=evidence_selector.max_evidence_tokens,
            max_items=evidence_selector.max_evidence_chunks,
            model_name=evidence_selector.model_name,
        )
        self._evidence_threshold = evidence_threshold
        self._max_rewrites = max_rewrites
        self._graph = self._compile()

    async def astream(
        self, initial_state: AgentGraphState, cancelled: asyncio.Event
    ) -> AsyncIterator[dict[str, Any]]:
        async for part in self._graph.astream(
            initial_state,
            context=WorkflowRuntimeContext(cancelled=cancelled),
            stream_mode="custom",
            version="v2",
            config={"recursion_limit": 12},
        ):
            if part["type"] == "custom":
                yield cast(dict[str, Any], part["data"])

    async def ainvoke(
        self, initial_state: AgentGraphState, cancelled: asyncio.Event | None = None
    ) -> AgentGraphState:
        return cast(
            AgentGraphState,
            await self._graph.ainvoke(
                initial_state,
                context=WorkflowRuntimeContext(cancelled=cancelled or asyncio.Event()),
                config={"recursion_limit": 12},
            ),
        )

    def _compile(self):
        graph = StateGraph(AgentGraphState, context_schema=WorkflowRuntimeContext)
        graph.add_node("understand", self._understand)
        graph.add_node("contextualize", self._contextualize)
        graph.add_node("retrieve", self._retrieve)
        graph.add_node("rank", self._rank)
        graph.add_node("rewrite", self._rewrite)
        graph.add_node("answer", self._answer)
        graph.add_node("clarify", self._clarify)
        graph.add_node("refuse", self._refuse)
        graph.add_edge(START, "understand")
        graph.add_edge("understand", "contextualize")
        graph.add_conditional_edges("contextualize", _initial_route, {
            "retrieve": "retrieve", "clarify": "clarify", "refuse": "refuse",
        })
        graph.add_edge("retrieve", "rank")
        graph.add_conditional_edges("rank", _after_evidence, {
            "answer": "answer", "rewrite": "rewrite", "refuse": "refuse",
        })
        graph.add_edge("rewrite", "retrieve")
        graph.add_edge("answer", END)
        graph.add_edge("clarify", END)
        graph.add_edge("refuse", END)
        return graph.compile()

    async def _understand(
        self, state: AgentGraphState, runtime: Runtime[WorkflowRuntimeContext]
    ) -> dict[str, Any]:
        _check_cancelled(runtime.context.cancelled)
        _emit("status", status="understanding")
        selected = set(state["selected_space_ids"])
        visible = selected.intersection(state["acl"].spaces) or (
            selected if state["acl"].admin else set()
        )
        profile = classify_question(state["query"], has_visible_space=bool(visible))
        return {"profile": profile, "effective_query": profile.normalized_query}

    async def _contextualize(
        self, state: AgentGraphState, runtime: Runtime[WorkflowRuntimeContext]
    ) -> dict[str, Any]:
        _check_cancelled(runtime.context.cancelled)
        if state["profile"].route == "refuse":
            return {}
        resolution = resolve_retrieval_query(
            state["query"], state.get("history", []), state.get("history_summary", "")
        )
        if resolution.needs_clarification:
            profile = QuestionProfile(
                route="clarify",
                use_graph=False,
                normalized_query=resolution.effective_query,
            )
        else:
            profile = classify_question(
                resolution.effective_query,
                has_visible_space=True,
            )
        return {
            "effective_query": resolution.effective_query,
            "contextualized": resolution.contextualized,
            "profile": profile,
        }

    async def _retrieve(
        self, state: AgentGraphState, runtime: Runtime[WorkflowRuntimeContext]
    ) -> dict[str, Any]:
        _check_cancelled(runtime.context.cancelled)
        _emit("status", status="retrieving")
        profile = state["profile"]
        query = state["effective_query"]
        document_task = self._retrieval.retrieve(
            query, state["selected_space_ids"], state["acl"], state["policies"]
        )
        graph_task: Awaitable[list[GraphEvidenceCandidate]] | None = None
        if profile.use_graph and self._graph_query is not None:
            graph_task = self._graph_query.query(query, state["selected_space_ids"], state["acl"])
        ranked, summary, graph_evidence = await _retrieve_in_parallel(
            document_task, graph_task, runtime.context.cancelled
        )
        attempt = state.get("retrieval_attempt", 0) + 1
        _emit(
            "retrieval",
            summary=summary,
            attempt=attempt,
            query=query,
            original_query=state["query"],
            contextualized=state.get("contextualized", False),
        )
        return {
            "ranked_chunks": ranked,
            "graph_evidence": graph_evidence,
            "summary": summary,
            "retrieval_trace": summary.trace,
            "retrieval_attempt": attempt,
        }

    async def _rank(
        self, state: AgentGraphState, runtime: Runtime[WorkflowRuntimeContext]
    ) -> dict[str, Any]:
        _check_cancelled(runtime.context.cancelled)
        _emit("status", status="ranking")
        summary = state["summary"]
        if summary is None:
            return {"evidence_chunks": [], "context_evidence": [], "terminal": "refuse"}
        score_type: Literal["reranker", "rrf"] = (
            "reranker" if summary.reranker_enabled and not summary.reranker_failed else "rrf"
        )
        documents = self._evidence_selector.select(
            state.get("ranked_chunks", []), score_type=score_type, query=state["effective_query"]
        )
        graph_evidence = state.get("graph_evidence", [])
        context = self._context_builder.build(documents, graph_evidence)
        if self._has_sufficient_document_evidence(documents) or self._context_builder.has_valid_graph_evidence(graph_evidence):
            terminal: Literal["answer", "rewrite", "refuse"] = "answer"
        elif state.get("rewrite_count", 0) < self._max_rewrites:
            terminal = "rewrite"
        else:
            terminal = "refuse"
        return {"evidence_chunks": documents, "context_evidence": context, "terminal": terminal}

    async def _rewrite(
        self, state: AgentGraphState, runtime: Runtime[WorkflowRuntimeContext]
    ) -> dict[str, Any]:
        _check_cancelled(runtime.context.cancelled)
        rewritten = _rewrite_query(state["effective_query"], state.get("ranked_chunks", []))
        # A bounded retry is still useful when there is no lexical expansion:
        # the underlying hybrid backends may return a transiently different set.
        return {
            "effective_query": rewritten or state["effective_query"],
            "rewrite_count": state.get("rewrite_count", 0) + 1,
        }

    async def _answer(
        self, state: AgentGraphState, runtime: Runtime[WorkflowRuntimeContext]
    ) -> dict[str, Any]:
        _check_cancelled(runtime.context.cancelled)
        _emit("status", status="answering")
        context = state.get("context_evidence", [])
        llm_enabled = any(policy.llm_enabled for policy in state["policies"])
        index_to_chunk: dict[str, RankedChunk] = {}
        if llm_enabled:
            prompt, index_to_chunk = _build_prompt(state["query"], context)
            messages = [ChatMessage(role="user", content=prompt)]
            parts: list[str] = []
            async for token in _stream_with_cancellation(self._chat.astream(messages), runtime.context.cancelled):
                parts.append(token)
                _emit("token", text=token)
            answer = "".join(parts)
        else:
            answer, index_to_chunk = _build_fallback_answer(context)
            _emit("token", text=answer)
        citation_chunks = _citation_chunks(answer, index_to_chunk, context)
        for chunk in citation_chunks:
            _emit("citation", chunk=chunk)
        return {"answer": answer, "citation_chunks": citation_chunks, "finish_reason": "stop"}

    async def _clarify(
        self, state: AgentGraphState, runtime: Runtime[WorkflowRuntimeContext]
    ) -> dict[str, Any]:
        _check_cancelled(runtime.context.cancelled)
        answer = "请补充你指代的对象或上一轮上下文，我再为你查询。"
        _emit("token", text=answer)
        return {"answer": answer, "citation_chunks": [], "finish_reason": "stop"}

    async def _refuse(
        self, state: AgentGraphState, runtime: Runtime[WorkflowRuntimeContext]
    ) -> dict[str, Any]:
        _check_cancelled(runtime.context.cancelled)
        answer = "当前没有可访问的知识空间，或现有资料不足，无法回答该问题。"
        _emit("token", text=answer)
        return {"answer": answer, "citation_chunks": [], "finish_reason": "stop"}

    def _has_sufficient_document_evidence(self, evidence: list[RankedChunk]) -> bool:
        if not evidence:
            return False
        top = evidence[0]
        score = top.rerank_score if top.rerank_score is not None else top.rrf_score
        return score is not None and score >= self._evidence_threshold


def _initial_route(state: AgentGraphState) -> str:
    return state["profile"].route


def _after_evidence(state: AgentGraphState) -> str:
    return cast(str, state["terminal"])


def _emit(event_type: str, **payload: Any) -> None:
    get_stream_writer()({"type": event_type, **payload})


def _check_cancelled(cancelled: asyncio.Event) -> None:
    if cancelled.is_set():
        raise WorkflowCancelled()


async def _await_or_cancel(operation: Awaitable[Any], cancelled: asyncio.Event) -> Any:
    task = asyncio.ensure_future(operation)
    cancel_task = asyncio.create_task(cancelled.wait())
    done, _ = await asyncio.wait({task, cancel_task}, return_when=asyncio.FIRST_COMPLETED)
    if cancel_task in done:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        raise WorkflowCancelled()
    cancel_task.cancel()
    await asyncio.gather(cancel_task, return_exceptions=True)
    return await task


async def _retrieve_in_parallel(
    document_operation: Awaitable[tuple[list[RankedChunk], RetrievalSummary]],
    graph_operation: Awaitable[list[GraphEvidenceCandidate]] | None,
    cancelled: asyncio.Event,
) -> tuple[list[RankedChunk], RetrievalSummary, list[GraphEvidenceCandidate]]:
    if graph_operation is None:
        ranked, summary = await _await_or_cancel(document_operation, cancelled)
        return ranked, summary, []
    document_result, graph_result = await _await_or_cancel(
        asyncio.gather(document_operation, graph_operation, return_exceptions=True), cancelled
    )
    if isinstance(document_result, BaseException):
        raise document_result
    if isinstance(graph_result, BaseException):
        logger.exception("Graph query failed; continuing with document retrieval", exc_info=graph_result)
        graph_result = []
    ranked, summary = document_result
    return ranked, summary, cast(list[GraphEvidenceCandidate], graph_result)


async def _stream_with_cancellation(
    stream: AsyncIterator[str], cancelled: asyncio.Event
) -> AsyncIterator[str]:
    iterator = stream.__aiter__()
    try:
        while True:
            try:
                token = await _await_or_cancel(anext(iterator), cancelled)
            except StopAsyncIteration:
                return
            yield token
    finally:
        if isinstance(iterator, AsyncGenerator):
            await iterator.aclose()


def _rewrite_query(query: str, ranked: list[RankedChunk]) -> str | None:
    keywords: set[str] = set()
    for item in ranked[:3]:
        for word in item.chunk.content.lower().split():
            if len(word) > 3 and word not in query.lower():
                keywords.add(word)
    return query + " " + " ".join(sorted(keywords)[:5]) if keywords else None


def _build_prompt(query: str, context: list[ContextEvidence]) -> tuple[str, dict[str, RankedChunk]]:
    index_to_chunk: dict[str, RankedChunk] = {}
    lines = [f"Question: {query}", "", "Evidence:"]
    for index, item in enumerate(context, start=1):
        index_to_chunk[str(index)] = item.chunk
        lines.append(ContextBuilder.render(item, index=index))
    lines.extend(["", "Instructions:", "Answer only from the evidence. Respond in clear Chinese and cite sources as [1], [2]."])
    return "\n".join(lines), index_to_chunk


def _build_fallback_answer(context: list[ContextEvidence]) -> tuple[str, dict[str, RankedChunk]]:
    mapping = {str(index): item.chunk for index, item in enumerate(context, start=1)}
    sentences = [f"{item.text.rstrip('。．,. ')}。[{index}]" for index, item in enumerate(context, start=1) if item.text.strip()]
    return (" ".join(sentences) if sentences else "根据现有资料无法回答该问题。"), mapping


def _citation_chunks(
    answer: str, mapping: dict[str, RankedChunk], context: list[ContextEvidence]
) -> list[RankedChunk]:
    ids = [match.group(1) for match in re.finditer(r"\[(\d{1,2})\]", answer)]
    chunks = [mapping[number] for number in ids if number in mapping]
    if not chunks:
        chunks = [item.chunk for item in context[:5]]
    unique: list[RankedChunk] = []
    seen = set()
    for chunk in chunks:
        if chunk.chunk.chunk_id not in seen:
            seen.add(chunk.chunk.chunk_id)
            unique.append(chunk)
    return unique
