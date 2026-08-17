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
    def __init__(self) -> None:
        self.messages: list[list[ChatMessage]] = []

    @property
    def model_name(self) -> str:
        return "test"

    @property
    def version(self) -> str:
        return "v1"

    async def achat(self, messages: list[ChatMessage], **_: object) -> ChatResponse:
        self.messages.append(messages)
        return ChatResponse(content="answer [1]")


class _Retrieval(RetrievalService):
    def __init__(self, chunks: list[RankedChunk]) -> None:
        self.chunks = chunks
        self.calls = 0
        self.queries: list[str] = []

    async def retrieve(self, query: str, space_ids: list[UUID], acl: AclSnapshot, policies: list[SpacePolicy]):
        self.calls += 1
        self.queries.append(query)
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
        self.queries: list[str] = []

    async def query(self, *args: object, **kwargs: object) -> list[GraphEvidenceCandidate]:
        self.calls += 1
        self.queries.append(args[0])
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
async def test_follow_up_uses_contextualized_query_for_document_and_graph_retrieval() -> None:
    space_id = uuid4()
    source = _chunk(space_id, "采购部门负责审批。")
    graph = _GraphTool([GraphEvidenceCandidate(uuid4(), "采购部门", "负责", "审批", 0.9, source)])
    retrieval = _Retrieval([source])
    chat = _Chat()
    agent = Agent(retrieval, chat, graph_query=graph)  # type: ignore[arg-type]
    inputs = _inputs(space_id)
    inputs["policies"] = [SpacePolicy(space_id, True, False, True)]
    inputs["history"] = [
        ChatMessage(role="user", content="采购申请由谁审批？"),
        ChatMessage(role="assistant", content="采购部门审批。"),
    ]

    events = [
        event
        async for event in agent.run(
            query="它是谁负责的？", cancelled=asyncio.Event(), **inputs
        )
    ]

    effective_query = "采购申请由谁审批？\n追问：它是谁负责的？"
    assert retrieval.queries == [effective_query]
    assert graph.queries == [effective_query]
    summary = next(event.summary for event in events if event.type == "retrieval.summary")
    assert summary["originalQuery"] == "它是谁负责的？"
    assert summary["query"] == effective_query
    assert summary["contextualized"] is True
    assert "Question: 它是谁负责的？" in chat.messages[-1][-1].content
    assert effective_query not in chat.messages[-1][-1].content
    assert any(event.type == "citation" for event in events)


@pytest.mark.asyncio
async def test_follow_up_includes_summary_in_document_and_graph_retrieval_queries() -> None:
    space_id = uuid4()
    source = _chunk(space_id, "采购部门负责审批。")
    graph = _GraphTool([GraphEvidenceCandidate(uuid4(), "采购部门", "负责", "审批", 0.9, source)])
    retrieval = _Retrieval([source])
    agent = Agent(retrieval, _Chat(), graph_query=graph)  # type: ignore[arg-type]
    inputs = _inputs(space_id)
    inputs["policies"] = [SpacePolicy(space_id, True, False, True)]
    inputs["history"] = [ChatMessage(role="user", content="最新用户问题")]
    summary = "此前已授权的用户话题：\n- 窗口外主题"

    events = [
        event
        async for event in agent.run(
            query="它是谁负责的？",
            history_summary=summary,
            cancelled=asyncio.Event(),
            **inputs,
        )
    ]

    effective_query = f"{summary}\n最新用户问题\n追问：它是谁负责的？"
    assert retrieval.queries == [effective_query]
    assert graph.queries == [effective_query]
    summary_event = next(event.summary for event in events if event.type == "retrieval.summary")
    assert summary_event["query"] == effective_query
    assert summary_event["contextualized"] is True


@pytest.mark.asyncio
async def test_answer_model_receives_only_evidence_prompt() -> None:
    space_id = uuid4()
    evidence = "evidence-only source passage"
    retrieval = _Retrieval([_chunk(space_id, evidence)])
    chat = _Chat()
    agent = Agent(retrieval, chat)
    inputs = _inputs(space_id)
    inputs["policies"] = [SpacePolicy(space_id, True, False, True)]
    inputs["history"] = [
        ChatMessage(role="user", content="history user secret"),
        ChatMessage(role="assistant", content="history assistant secret"),
    ]
    summary = "此前已授权的用户话题：\n- history summary secret"

    _ = [
        event
        async for event in agent.run(
            query="independent question",
            history_summary=summary,
            cancelled=asyncio.Event(),
            **inputs,
        )
    ]

    assert len(chat.messages[-1]) == 1
    prompt = chat.messages[-1][0].content
    assert evidence in prompt
    assert "history user secret" not in prompt
    assert "history assistant secret" not in prompt
    assert "history summary secret" not in prompt


@pytest.mark.asyncio
async def test_orphan_follow_up_without_history_clarifies_without_retrieval() -> None:
    space_id = uuid4()
    retrieval = _Retrieval([])
    graph = _GraphTool([])
    agent = Agent(retrieval, _Chat(), graph_query=graph)  # type: ignore[arg-type]

    events = [
        event
        async for event in agent.run(
            query="它是谁负责的？", cancelled=asyncio.Event(), **_inputs(space_id)
        )
    ]

    assert retrieval.calls == 0
    assert graph.calls == 0
    assert not any(event.type == "retrieval.summary" for event in events)
    assert any(event.type == "text.delta" for event in events)


@pytest.mark.asyncio
async def test_evaluation_returns_the_contextualized_query() -> None:
    space_id = uuid4()
    retrieval = _Retrieval([_chunk(space_id)])
    agent = Agent(retrieval, _Chat())
    inputs = _inputs(space_id)
    inputs.pop("history")

    result = await agent.run_evaluation(
        query="它是谁负责的？",
        history=[ChatMessage(role="user", content="采购申请由谁审批？")],
        **inputs,
    )

    assert result.effective_query == "采购申请由谁审批？\n追问：它是谁负责的？"


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
