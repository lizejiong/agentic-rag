from __future__ import annotations

from uuid import UUID

from rag_ai.graph.service import GraphService
from rag_ai.retrieval.models import AclSnapshot, RankedChunk, RetrievedChunk


class GraphQueryTool:
    def __init__(self, service: GraphService, *, limit: int = 5) -> None:
        self._service = service
        self._limit = limit

    async def query(self, question: str, space_ids: list[UUID], acl: AclSnapshot) -> list[RankedChunk]:
        results: list[RankedChunk] = []
        for space_id in space_ids:
            if not acl.can_view_space(space_id):
                continue
            relations = await self._service.list_relations(space_id, acl, status="PUBLISHED", query="", limit=50)
            for relation in relations:
                if not any(term and term in question for term in (relation.subject, relation.object, relation.predicate)):
                    continue
                for evidence in relation.evidence[:1]:
                    results.append(RankedChunk(
                        RetrievedChunk(
                            chunk_id=evidence.chunk_id, document_id=evidence.document_id, version_id=evidence.version_id,
                            space_id=space_id,
                            content=f"图谱关系：{relation.subject} {relation.predicate} {relation.object}。\n来源：{evidence.content}",
                            title=evidence.title, location=_location(evidence.location), score=1.0, path="rerank",
                            metadata={"graph_relation_id": str(relation.id)},
                        ), rrf_score=1.0, rerank_score=1.0,
                    ))
                    if len(results) >= self._limit:
                        return results
        return results


def _location(value: dict[str, object]):
    from rag_ai.retrieval.models import CitationLocation
    return CitationLocation(page=_int_or_none(value.get("page")), slide=_int_or_none(value.get("slide")), sheet=_str_or_none(value.get("sheet")), cell_range=_str_or_none(value.get("cellRange")))


def _int_or_none(value: object) -> int | None:
    return value if isinstance(value, int) else None


def _str_or_none(value: object) -> str | None:
    return value if isinstance(value, str) else None
