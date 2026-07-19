import asyncio
from collections.abc import AsyncIterator
from datetime import datetime, timezone
from typing import TypedDict
from uuid import UUID

from rag_ai.contracts.agent_events import (
    AgentEvent,
    Citation,
    CitationLocation,
    RunCompleted,
    RunRequest,
    RunStarted,
    RunStatus,
    TextDelta,
)


class EventFields(TypedDict):
    requestId: UUID
    traceId: str
    seq: int
    occurredAt: datetime


def event_fields(request: RunRequest, seq: int) -> EventFields:
    return {
        "requestId": request.requestId,
        "traceId": request.traceId,
        "seq": seq,
        "occurredAt": datetime.now(timezone.utc),
    }


async def fake_agent_events(request: RunRequest, cancelled: asyncio.Event) -> AsyncIterator[AgentEvent]:
    seq = 0
    yield RunStarted(**event_fields(request, seq), type="run.started")
    seq += 1
    yield RunStatus(**event_fields(request, seq), type="run.status", status="retrieving")
    seq += 1

    for text in ("这是", "一个", "可取消", "的假答案"):
        await asyncio.sleep(0.01)
        if cancelled.is_set():
            yield RunCompleted(
                **event_fields(request, seq), type="run.completed", finishReason="cancelled"
            )
            return
        yield TextDelta(**event_fields(request, seq), type="text.delta", text=text)
        seq += 1

    if cancelled.is_set():
        yield RunCompleted(**event_fields(request, seq), type="run.completed", finishReason="cancelled")
        return

    yield Citation(
        **event_fields(request, seq),
        type="citation",
        citationId=UUID("00000000-0000-4000-8000-000000000002"),
        title="协议示例文档",
        snippet="仅用于验证流式引用。",
        location=CitationLocation(page=1),
    )
    seq += 1
    yield RunCompleted(**event_fields(request, seq), type="run.completed", finishReason="stop")
