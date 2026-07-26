from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from rag_ai.ingestion.models import IngestionCommand, IngestionResult
from rag_ai.models.base import EmbeddingModel
from rag_ai.retrieval.lexical_repository import LexicalRepository
from rag_ai.retrieval.models import CitationLocation, RetrievedChunk


@dataclass(frozen=True)
class IndexResult:
    embedded_count: int
    lexical_indexed_count: int


class ChunkIndexer:
    def __init__(
        self,
        engine: AsyncEngine,
        embedding_model: EmbeddingModel,
        lexical_repo: LexicalRepository,
    ) -> None:
        self._engine = engine
        self._embedding_model = embedding_model
        self._lexical_repo = lexical_repo

    async def index(
        self,
        *,
        command: IngestionCommand,
        result: IngestionResult,
    ) -> None:
        """Index all chunks for a completed ingestion run.

        This is called after `repository.succeed` has persisted chunks. It is
        intentionally separate so that embedding/ES failures can be retried
        without re-running parsing.
        """
        await self.index_chunks(
            document_id=command.payload.document_id,
            version_id=command.payload.version_id,
            space_id=command.payload.space_id,
            title=result.document.title,
            chunks=result.chunks,
            acl_snapshot=command.payload.acl_snapshot,
        )

    async def index_chunks(
        self,
        *,
        document_id: UUID,
        version_id: UUID,
        space_id: UUID,
        title: str,
        chunks: list[Any],
        acl_snapshot: dict[str, Any],
    ) -> IndexResult:
        """Index all chunks for a completed ingestion run.

        This is called after `repository.succeed` has persisted chunks. It is
        intentionally separate so that embedding/ES failures can be retried
        without re-running parsing.
        """
        # Load persisted chunk rows so we have the database IDs.
        async with self._engine.connect() as connection:
            result = await connection.execute(
                text(
                    """
                    SELECT id, content, location
                    FROM rag.chunks
                    WHERE version_id = :version_id
                    ORDER BY chunk_index ASC
                    """
                ),
                {"version_id": version_id},
            )
            rows = result.mappings().all()

            space_result = await connection.execute(
                text(
                    """
                    SELECT embedding_enabled
                    FROM app.knowledge_spaces
                    WHERE id = :space_id
                    """
                ),
                {"space_id": space_id},
            )
            space_row = space_result.mappings().one_or_none()

        embedding_enabled = space_row["embedding_enabled"] if space_row else False

        if not rows:
            return IndexResult(embedded_count=0, lexical_indexed_count=0)

        embedded_count = 0
        if embedding_enabled:
            embed_result = await self._embedding_model.embed(
                [row["content"] for row in rows]
            )
            embeddings = embed_result.embeddings
            async with self._engine.begin() as connection:
                await connection.execute(
                    text(
                        """
                        INSERT INTO rag.chunk_embeddings (
                            id, chunk_id, embedding_model, embedding_version, dimensions, embedding
                        ) VALUES (
                            gen_random_uuid(), :chunk_id, :embedding_model,
                            :embedding_version, :dimensions, :embedding
                        )
                        ON CONFLICT (chunk_id, embedding_model, embedding_version) DO UPDATE
                        SET dimensions = EXCLUDED.dimensions,
                            embedding = EXCLUDED.embedding,
                            created_at = NOW()
                        """
                    ),
                    [
                        {
                            "chunk_id": row["id"],
                            "embedding_model": self._embedding_model.model_name,
                            "embedding_version": self._embedding_model.version,
                            "dimensions": len(vector),
                            "embedding": _vector_literal(vector),
                        }
                        for row, vector in zip(rows, embeddings, strict=True)
                    ],
                )
                await connection.execute(
                    text(
                        """
                        UPDATE rag.chunks
                        SET indexed_at = NOW(), is_searchable = true
                        WHERE version_id = :version_id
                        """
                    ),
                    {"version_id": version_id},
                )
            embedded_count = len(rows)
        else:
            async with self._engine.begin() as connection:
                await connection.execute(
                    text(
                        """
                        UPDATE rag.chunks
                        SET indexed_at = NOW(), is_searchable = true
                        WHERE version_id = :version_id
                        """
                    ),
                    {"version_id": version_id},
                )

        # Always index lexically; ES is the required index.
        await self._lexical_repo.ensure_index()
        for row in rows:
            location = _parse_location(row["location"])
            chunk = RetrievedChunk(
                chunk_id=row["id"],
                document_id=document_id,
                version_id=version_id,
                space_id=space_id,
                content=row["content"],
                title=title,
                location=location,
                score=0.0,
                path="lexical",
                metadata={"acl_snapshot": acl_snapshot},
            )
            await self._lexical_repo.index_chunk(chunk)

        return IndexResult(
            embedded_count=embedded_count,
            lexical_indexed_count=len(rows),
        )


def _vector_literal(vector: list[float]) -> str:
    return "[" + ",".join(str(value) for value in vector) + "]"


def _parse_location(raw: Any) -> CitationLocation:
    if not isinstance(raw, dict):
        return CitationLocation()
    return CitationLocation(
        page=raw.get("page"),
        slide=raw.get("slide"),
        sheet=raw.get("sheet"),
        cell_range=raw.get("cellRange"),
    )
