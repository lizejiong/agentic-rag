from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from rag_ai.retrieval.models import AclSnapshot, CitationLocation, RetrievedChunk


@dataclass(frozen=True)
class VectorSearchResult:
    chunk_id: UUID
    score: float


class VectorRepository:
    def __init__(self, engine: AsyncEngine, embedding_model: str, embedding_version: str) -> None:
        self._engine = engine
        self._embedding_model = embedding_model
        self._embedding_version = embedding_version

    async def search(
        self,
        query_embedding: list[float],
        space_ids: list[UUID],
        acl: AclSnapshot,
        *,
        top_k: int,
    ) -> list[RetrievedChunk]:
        if not space_ids:
            return []

        # Build ACL predicate inline. This keeps the query a single round-trip.
        # The ACL snapshot JSON shape is {"documentSubjects": [{"subjectType", "subjectId"}]}.
        vector_literal = "[" + ",".join(str(value) for value in query_embedding) + "]"
        allowed_space_ids = [space_id for space_id in space_ids if acl.can_view_space(space_id)]
        if not allowed_space_ids:
            return []

        async with self._engine.connect() as connection:
            result = await connection.execute(
                text(
                    """
                    SELECT
                        c.id AS chunk_id,
                        c.document_id,
                        c.version_id,
                        c.space_id,
                        c.content,
                        c.location,
                        c.acl_snapshot,
                        nd.title,
                        e.embedding <=> :embedding AS score
                    FROM rag.chunk_embeddings e
                    JOIN rag.chunks c ON c.id = e.chunk_id
                    JOIN rag.normalized_documents nd ON nd.id = c.normalized_document_id
                    WHERE c.space_id = ANY(:space_ids)
                      AND c.is_searchable = true
                      AND e.embedding_model = :embedding_model
                      AND e.embedding_version = :embedding_version
                      AND e.dimensions = :dimensions
                    ORDER BY e.embedding <=> :embedding
                    LIMIT :top_k * 4
                    """
                ),
                {
                    "embedding": vector_literal,
                    "space_ids": [str(space_id) for space_id in allowed_space_ids],
                    "embedding_model": self._embedding_model,
                    "embedding_version": self._embedding_version,
                    "dimensions": len(query_embedding),
                    "top_k": top_k,
                },
        )
            rows = result.mappings().all()

        candidates: list[RetrievedChunk] = []
        for row in rows:
            if not acl.can_read_document(row["space_id"], row["acl_snapshot"]):
                continue
            location = _parse_location(row["location"])
            candidates.append(
                RetrievedChunk(
                    chunk_id=row["chunk_id"],
                    document_id=row["document_id"],
                    version_id=row["version_id"],
                    space_id=row["space_id"],
                    content=row["content"],
                    title=row["title"],
                    location=location,
                    score=float(row["score"]),
                    path="vector",
                )
            )
            if len(candidates) >= top_k:
                break
        return candidates


def _parse_location(raw: Any) -> CitationLocation:
    if not isinstance(raw, dict):
        return CitationLocation()
    return CitationLocation(
        page=raw.get("page"),
        slide=raw.get("slide"),
        sheet=raw.get("sheet"),
        cell_range=raw.get("cellRange"),
    )
