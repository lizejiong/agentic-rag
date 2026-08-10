from __future__ import annotations

import asyncio
from uuid import UUID, uuid4

import pytest

from rag_ai.agent.context_builder import GraphEvidenceCandidate
from rag_ai.agent.runner import Agent
from rag_ai.models.base import ChatMessage, ChatModel, ChatResponse
from rag_ai.retrieval.models import AclSnapshot, CitationLocation, RankedChunk, RetrievedChunk, RetrievalSummary, SpacePolicy
from rag_ai.retrieval.service import RetrievalService


class _Chat(ChatModel):
    @property
    def model_name(self) -> str:
        return "test"

    @property
    def version(self) -> str:
        return "v1"

    async def achat(self, messages: list[ChatMessage], **_: object) -> ChatResponse:
        return ChatResponse(content="answer [1]")


class _Retrieval(RetrievalService):
    def __init__(self, chunks: list[RankedChunk]) -> None:
        self.chunks = chunks
        self.calls = 0

    async def retrieve(self, query: str, space_ids: list[UUID], acl: AclSnapshot, policies: list[SpacePolicy]):
        self.calls += 1
        return self.chunks, RetrievalSummary(query, 1, 1, 60, 5, 5, False)


class _SlowRetrieval(_Retrieval):
    def __init__(self) -> None:
        super().__init__([])
        self.started = asyncio.Event()
        self.was_cancelled = False

    async def retrieve(self, *args: object, **kwargs: object):
        self.started.set()
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            self.was_cancelled = True
            raise


class _GraphTool:
    def __init__(self, result: list[GraphEvidenceCandidate]) -> None:
        self.result = result
        self.calls = 0

    async def query(self, *args: object, **kwargs: object) -> list[GraphEvidenceCandidate]:
        self.calls += 1
        return self.result


def _chunk(space_id: UUID, content: str = "source passage") -> RankedChunk:
    return RankedChunk(
        RetrievedChunk(uuid4(), uuid4(), uuid4(), space_id, content, "source", CitationLocation(page=1), 0.4, "rrf"),
        rrf_score=0.4,
    )


def _inputs(space_id: UUID):
    return {
        "request_id": uuid4(), "trace_id": "trace", "actor_id": "actor",
        "selected_space_ids": [space_id],
        "acl": AclSnapshot(uuid4(), False, spaces={space_id: "VIEW"}),
        "policies": [SpacePolicy(space_id, True, False, False)],
        "history": [],
    }


@pytest.mark.asyncio
async def test_relation_question_retrieves_documents_and_graph_in_same_run() -> None:
    space_id = uuid4()
    source = _chunk(space_id, "采购部门负责审批。")
    graph = _GraphTool([GraphEvidenceCandidate(uuid4(), "采购部门", "负责", "审批", 0.9, source)])
    retrieval = _Retrieval([source])
    agent = Agent(retrieval, _Chat(), graph_query=graph)  # type: ignore[arg-type]

    events = [event async for event in agent.run(query="采购部门和审批是什么关系？", cancelled=asyncio.Event(), **_inputs(space_id))]

    assert retrieval.calls == 1
    assert graph.calls == 1
    assert any(event.type == "citation" for event in events)
    assert "知识图谱关系" in "".join(event.text for event in events if event.type == "text.delta")


@pytest.mark.asyncio
async def test_cancellation_cancels_inflight_retrieval_and_only_completes_cancelled() -> None:
    space_id = uuid4()
    retrieval = _SlowRetrieval()
    agent = Agent(retrieval, _Chat())
    cancelled = asyncio.Event()
    stream = agent.run(query="查询资料", cancelled=cancelled, **_inputs(space_id))

    assert (await anext(stream)).type == "run.started"
    assert (await anext(stream)).type == "run.status"  # understanding
    assert (await anext(stream)).type == "run.status"  # retrieving
    pending = asyncio.create_task(anext(stream))
    await asyncio.wait_for(retrieval.started.wait(), timeout=1)
    cancelled.set()
    completed = await asyncio.wait_for(pending, timeout=1)

    assert completed.type == "run.completed"
    assert completed.finishReason == "cancelled"
    assert retrieval.was_cancelled is True
    with pytest.raises(StopAsyncIteration):
        await anext(stream)
