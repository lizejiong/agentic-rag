import pytest
from langgraph.graph import END, START, StateGraph
from typing_extensions import TypedDict


class _State(TypedDict):
    value: int


@pytest.mark.asyncio
async def test_state_graph_runs_an_async_node() -> None:
    async def increment(state: _State) -> dict[str, int]:
        return {"value": state["value"] + 1}

    graph = StateGraph(_State)
    graph.add_node("increment", increment)
    graph.add_edge(START, "increment")
    graph.add_edge("increment", END)

    assert await graph.compile().ainvoke({"value": 1}) == {"value": 2}
