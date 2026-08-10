from __future__ import annotations

from uuid import UUID

from rag_ai.agent.context_builder import GraphEvidenceCandidate
from rag_ai.graph.service import GraphService
from rag_ai.retrieval.models import AclSnapshot, CitationLocation, RankedChunk, RetrievedChunk


class GraphQueryTool:
    def __init__(self, service: GraphService, *, limit: int = 5) -> None:
        self._service = service
        self._limit = limit

    async def query(
        self, question: str, space_ids: list[UUID], acl: AclSnapshot
    ) -> list[GraphEvidenceCandidate]:
        """Return only published, ACL-visible relations with source evidence.

        A graph relation is a structured fact, not a reranked document.  Its
        source chunk therefore intentionally carries no synthetic relevance
        score; the workflow evaluates graph validity separately.
        """
        results: list[GraphEvidenceCandidate] = []
        question_folded = question.casefold()
        for space_id in space_ids:
            if not acl.can_view_space(space_id):
                continue
            relations = await self._service.list_relations(
                space_id, acl, status="PUBLISHED", query="", limit=50
            )
            for relation in relations:
                if not any(
                    term and term.casefold() in question_folded
                    for term in (relation.subject, relation.object, relation.predicate)
                ):
                    continue
                for evidence in relation.evidence[:1]:
                    chunk = RankedChunk(
                        RetrievedChunk(
                            chunk_id=evidence.chunk_id,
                            document_id=evidence.document_id,
                            version_id=evidence.version_id,
                            space_id=space_id,
                            content=evidence.content,
                            title=evidence.title,
                            location=_location(evidence.location),
                            score=0.0,
                            path="rrf",
                            metadata={"graph_relation_id": str(relation.id)},
                        ),
                        rrf_score=None,
                        rerank_score=None,
                    )
                    results.append(GraphEvidenceCandidate(
                        relation_id=relation.id,
                        subject=relation.subject,
                        predicate=relation.predicate,
                        object_name=relation.object,
                        confidence=relation.confidence,
                        evidence=chunk,
                    ))
                    if len(results) >= self._limit:
                        return results
        return results


def _location(value: dict[str, object]) -> CitationLocation:
    return CitationLocation(
        page=_int_or_none(value.get("page")),
        slide=_int_or_none(value.get("slide")),
        sheet=_str_or_none(value.get("sheet")),
        cell_range=_str_or_none(value.get("cellRange")),
    )


def _int_or_none(value: object) -> int | None:
    return value if isinstance(value, int) else None


def _str_or_none(value: object) -> str | None:
    return value if isinstance(value, str) else None
