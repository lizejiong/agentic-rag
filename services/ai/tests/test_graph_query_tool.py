from __future__ import annotations

from uuid import UUID, uuid4

import pytest

from rag_ai.graph.models import GraphEvidence, GraphRelation
from rag_ai.graph.query_tool import GraphQueryTool
from rag_ai.retrieval.models import AclSnapshot


class FakeGraphService:
    def __init__(self, relation: GraphRelation) -> None:
        self.relation = relation
        self.calls = 0

    async def list_relations(self, *args: object, **kwargs: object) -> list[GraphRelation]:
        self.calls += 1
        return [self.relation]


def _relation(space_id: UUID) -> GraphRelation:
    chunk_id, document_id, version_id = uuid4(), uuid4(), uuid4()
    evidence = GraphEvidence(uuid4(), "采购部", "负责", "审批", chunk_id, document_id, version_id, "采购部负责审批", "采购流程", {"page": 2})
    return GraphRelation(uuid4(), space_id, uuid4(), "采购部", "部门", "负责", uuid4(), "审批", "流程", "PUBLISHED", 0.9, [evidence])


@pytest.mark.asyncio
async def test_graph_query_requires_space_access_and_keeps_original_chunk_identity() -> None:
    space_id = uuid4()
    service = FakeGraphService(_relation(space_id))
    tool = GraphQueryTool(service, limit=5)  # type: ignore[arg-type]

    denied = await tool.query("采购部负责什么？", [space_id], AclSnapshot(uuid4(), False))
    allowed = await tool.query("采购部负责什么？", [space_id], AclSnapshot(uuid4(), False, spaces={space_id: "VIEW"}))

    assert denied == []
    assert service.calls == 1
    assert allowed[0].evidence.chunk.document_id == service.relation.evidence[0].document_id
    assert allowed[0].evidence.chunk.chunk_id == service.relation.evidence[0].chunk_id
    assert allowed[0].evidence.rerank_score is None
