import asyncio

import pytest
from langgraph.config import get_stream_writer
from langgraph.graph import END, START, StateGraph
from typing_extensions import TypedDict


class _State(TypedDict):
    value: int


@pytest.mark.asyncio
async def test_custom_stream_arrives_before_node_finishes() -> None:
    release = asyncio.Event()

    async def stream_token(state: _State) -> dict[str, int]:
        get_stream_writer()({"type": "token", "text": "A"})
        await release.wait()
        return {"value": state["value"] + 1}

    builder = StateGraph(_State)
    builder.add_node("stream_token", stream_token)
    builder.add_edge(START, "stream_token")
    builder.add_edge("stream_token", END)
    stream = builder.compile().astream(
        {"value": 1}, stream_mode="custom", version="v2"
    )

    first = await asyncio.wait_for(anext(stream), timeout=1)
    assert first == {
        "type": "custom",
        "ns": (),
        "data": {"type": "token", "text": "A"},
    }
    release.set()
    async for _part in stream:
        pass
