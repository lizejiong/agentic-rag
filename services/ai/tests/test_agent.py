from __future__ import annotations

import asyncio
from uuid import UUID, uuid4

import pytest

from rag_ai.agent.runner import Agent
from rag_ai.models.base import ChatModel, ChatMessage, ChatResponse
from rag_ai.retrieval.models import (
    AclSnapshot,
    CitationLocation,
    RankedChunk,
    RetrievedChunk,
    RetrievalSummary,
    SpacePolicy,
)
from rag_ai.retrieval.service import RetrievalService


class FakeRetrieval(RetrievalService):
    def __init__(self, chunks: list[RankedChunk]) -> None:  # noqa: D107
        self._chunks = chunks

    async def retrieve(
        self, query: str, space_ids: list[UUID], acl: AclSnapshot, policies: list[SpacePolicy]
    ) -> tuple[list[RankedChunk], RetrievalSummary]:
        return self._chunks, RetrievalSummary(query=query, vector_top_k=0, lexical_top_k=0, rrf_k=60, rrf_top_k=0, rerank_top_k=0, reranker_enabled=False)


class EchoChatModel(ChatModel):
    @property
    def model_name(self) -> str:
        return "echo"

    @property
    def version(self) -> str:
        return "v1"

    async def achat(
        self,
        messages: list[ChatMessage],
        *,
        temperature: float = 0.3,
        max_tokens: int = 2048,
        stop: list[str] | None = None,
    ) -> ChatResponse:
        return ChatResponse(content=messages[-1].content)


def _ranked(text: str, score: float = 0.5) -> RankedChunk:
    return RankedChunk(
        chunk=RetrievedChunk(
            chunk_id=uuid4(),
            document_id=uuid4(),
            version_id=uuid4(),
            space_id=uuid4(),
            content=text,
            title="doc",
            location=CitationLocation(page=1),
            score=score,
            path="vector",
        ),
        rrf_score=score,
    )


@pytest.mark.asyncio
async def test_agent_returns_answer_with_citations() -> None:
    chunk = _ranked("The answer is 42.")
    agent = Agent(retrieval=FakeRetrieval([chunk]), chat=EchoChatModel())
    events = []
    async for event in agent.run(
        request_id=uuid4(),
        trace_id="trace",
        actor_id="actor",
        query="what is the answer?",
        selected_space_ids=[],
        acl=AclSnapshot(user_id=uuid4(), admin=False, group_ids=[], spaces={}),
        policies=[SpacePolicy(uuid4(), True, True, True)],
        history=[],
        cancelled=asyncio.Event(),
    ):
        events.append(event)

    assert events[0].type == "run.started"
    assert events[-1].type == "run.completed"
    assert any(event.type == "citation" for event in events)
    text = "".join(event.text for event in events if event.type == "text.delta")
    assert "42" in text or "answer" in text


@pytest.mark.asyncio
async def test_agent_declines_when_no_evidence() -> None:
    agent = Agent(retrieval=FakeRetrieval([]), chat=EchoChatModel())
    events = []
    async for event in agent.run(
        request_id=uuid4(),
        trace_id="trace",
        actor_id="actor",
        query="unknown",
        selected_space_ids=[],
        acl=AclSnapshot(user_id=uuid4(), admin=False, group_ids=[], spaces={}),
        policies=[SpacePolicy(uuid4(), True, True, True)],
        history=[],
        cancelled=asyncio.Event(),
    ):
        events.append(event)

    text = "".join(event.text for event in events if event.type == "text.delta")
    assert "无法回答" in text or "无法" in text


@pytest.mark.asyncio
async def test_agent_respects_cancel_event() -> None:
    chunk = _ranked("Long content that will be streamed.")
    agent = Agent(retrieval=FakeRetrieval([chunk]), chat=EchoChatModel())
    cancelled = asyncio.Event()

    events = []
    async for event in agent.run(
        request_id=uuid4(),
        trace_id="trace",
        actor_id="actor",
        query="stream",
        selected_space_ids=[],
        acl=AclSnapshot(user_id=uuid4(), admin=False, group_ids=[], spaces={}),
        policies=[SpacePolicy(uuid4(), True, True, True)],
        history=[],
        cancelled=cancelled,
    ):
        events.append(event)
        if event.type == "text.delta":
            cancelled.set()

    assert any(event.type == "run.completed" for event in events)
