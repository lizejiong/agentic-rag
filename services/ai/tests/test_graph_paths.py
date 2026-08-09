from __future__ import annotations

from typing import cast
from uuid import uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncEngine

from rag_ai.graph.models import GraphRelation
from rag_ai.graph.service import GraphService
from rag_ai.models.base import ChatModel
from rag_ai.retrieval.models import AclSnapshot


class FakeResult:
    async def data(self) -> list[dict[str, list[str]]]:
        return [{"relation_ids": [str(self.visible_id), str(self.hidden_id)]}]

    def __init__(self, visible_id: object, hidden_id: object) -> None:
        self.visible_id = visible_id
        self.hidden_id = hidden_id


class FakeSession:
    def __init__(self, visible_id: object, hidden_id: object) -> None:
        self.result = FakeResult(visible_id, hidden_id)
        self.query = ""

    async def __aenter__(self) -> FakeSession:
        return self

    async def __aexit__(self, *_args: object) -> None:
        return None

    async def run(self, query: str, **_params: object) -> FakeResult:
        self.query = query
        return self.result


class FakeDriver:
    def __init__(self, session: FakeSession) -> None:
        self._session = session

    def session(self) -> FakeSession:
        return self._session


class FakeRepository:
    def __init__(self, relation: GraphRelation) -> None:
        self._relation = relation

    async def list_relations(self, *_args: object, **_kwargs: object) -> list[GraphRelation]:
        return [self._relation]


@pytest.mark.asyncio
async def test_paths_do_not_return_a_partial_path_when_an_edge_is_not_visible() -> None:
    space_id, visible_id, hidden_id = uuid4(), uuid4(), uuid4()
    relation = GraphRelation(visible_id, space_id, uuid4(), "A", "Concept", "depends_on", uuid4(), "B", "Concept", "PUBLISHED", 0.9, [])
    session = FakeSession(visible_id, hidden_id)
    service = GraphService(cast(AsyncEngine, object()), cast(ChatModel, object()), driver=cast(object, FakeDriver(session)), extraction_version="v1")
    service._repository = cast(object, FakeRepository(relation))  # type: ignore[assignment]

    paths = await service.find_paths(space_id, uuid4(), uuid4(), AclSnapshot(uuid4(), True), max_hops=1)

    assert paths == []
    assert "PUBLISHED_RELATION*1..1" in session.query
