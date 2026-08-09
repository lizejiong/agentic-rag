from __future__ import annotations

import json
from uuid import UUID

from neo4j import AsyncDriver
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection
from sqlalchemy.ext.asyncio import AsyncEngine

from rag_ai.graph.models import GraphEvidence, GraphRelation, GraphRelationCandidate
from rag_ai.retrieval.models import AclSnapshot


class GraphRepository:
    def __init__(self, engine: AsyncEngine, driver: AsyncDriver | None = None) -> None:
        self._engine = engine
        self._driver = driver

    async def save_candidates(self, *, space_id: UUID, document_id: UUID, version_id: UUID, extraction_version: str, chunks: list[dict[str, object]], candidates_by_chunk: dict[UUID, list[GraphRelationCandidate]]) -> int:
        inserted = 0
        async with self._engine.begin() as connection:
            await connection.execute(text("""
                INSERT INTO rag.graph_extraction_runs (document_id, version_id, space_id, status, extraction_version, started_at, completed_at)
                VALUES (:document_id, :version_id, :space_id, 'PENDING_REVIEW', :extraction_version, NOW(), NOW())
                ON CONFLICT (version_id) DO UPDATE SET status='PENDING_REVIEW', extraction_version=EXCLUDED.extraction_version, completed_at=NOW(), error_code=NULL, error_message=NULL
            """), {"document_id": document_id, "version_id": version_id, "space_id": space_id, "extraction_version": extraction_version})
            chunks_by_id = {UUID(str(row["id"])): row for row in chunks}
            for chunk_id, candidates in candidates_by_chunk.items():
                chunk = chunks_by_id[chunk_id]
                content = str(chunk["content"])
                for candidate in candidates:
                    if candidate.quote not in content:
                        continue
                    subject_id = await self._upsert_entity(connection, space_id, candidate.subject, candidate.subject_type, candidate.confidence)
                    object_id = await self._upsert_entity(connection, space_id, candidate.object, candidate.object_type, candidate.confidence)
                    relation = await connection.execute(text("""
                        INSERT INTO rag.graph_relations (space_id, subject_entity_id, predicate, object_entity_id, status, origin, confidence, extraction_version)
                        VALUES (:space_id, :subject_id, :predicate, :object_id, 'PENDING_REVIEW', 'AUTO', :confidence, :extraction_version)
                        ON CONFLICT (space_id, subject_entity_id, predicate, object_entity_id) DO UPDATE
                        SET confidence=GREATEST(rag.graph_relations.confidence, EXCLUDED.confidence),
                            status=CASE WHEN rag.graph_relations.origin='AUTO' THEN 'PENDING_REVIEW' ELSE rag.graph_relations.status END,
                            updated_at=NOW()
                        RETURNING id
                    """), {"space_id": space_id, "subject_id": subject_id, "predicate": candidate.predicate, "object_id": object_id, "confidence": candidate.confidence, "extraction_version": extraction_version})
                    relation_id = relation.scalar_one()
                    await connection.execute(text("""
                        INSERT INTO rag.graph_evidence (relation_id, chunk_id, document_id, version_id, quote, location, confidence)
                        VALUES (:relation_id, :chunk_id, :document_id, :version_id, :quote, CAST(:location AS jsonb), :confidence)
                        ON CONFLICT (relation_id, chunk_id) DO UPDATE SET active=TRUE, quote=EXCLUDED.quote, confidence=EXCLUDED.confidence
                    """), {"relation_id": relation_id, "chunk_id": chunk_id, "document_id": document_id, "version_id": version_id, "quote": candidate.quote, "location": json.dumps(chunk["location"]), "confidence": candidate.confidence})
                    inserted += 1
        return inserted

    async def _upsert_entity(self, connection: AsyncConnection, space_id: UUID, name: str, entity_type: str, confidence: float) -> UUID:
        result = await connection.execute(text("""
            INSERT INTO rag.graph_entities (space_id, canonical_name, entity_type, status, origin, confidence)
            VALUES (:space_id, :name, :entity_type, 'PENDING_REVIEW', 'AUTO', :confidence)
            ON CONFLICT (space_id, canonical_name, entity_type) DO UPDATE SET confidence=GREATEST(rag.graph_entities.confidence, EXCLUDED.confidence), updated_at=NOW()
            RETURNING id
        """), {"space_id": space_id, "name": " ".join(name.split()), "entity_type": entity_type, "confidence": confidence})
        return result.scalar_one()

    async def list_relations(self, space_id: UUID, acl: AclSnapshot, *, status: str | None = None, query: str = "", limit: int = 50) -> list[GraphRelation]:
        async with self._engine.connect() as connection:
            rows = (await connection.execute(text("""
                SELECT r.id, r.space_id, r.status, r.confidence, se.id AS subject_entity_id, se.canonical_name AS subject, se.entity_type AS subject_type,
                       r.predicate, oe.id AS object_entity_id, oe.canonical_name AS object, oe.entity_type AS object_type,
                       e.chunk_id, e.document_id, e.version_id, e.location, c.content, n.title, c.acl_snapshot
                FROM rag.graph_relations r
                JOIN rag.graph_entities se ON se.id=r.subject_entity_id JOIN rag.graph_entities oe ON oe.id=r.object_entity_id
                JOIN rag.graph_evidence e ON e.relation_id=r.id AND e.active=TRUE
                JOIN rag.chunks c ON c.id=e.chunk_id AND c.is_searchable=TRUE JOIN rag.normalized_documents n ON n.id=c.normalized_document_id
                JOIN app.documents d ON d.id=e.document_id AND d.active_version_id=e.version_id AND d.availability='ACTIVE'
                WHERE r.space_id=:space_id AND (:status IS NULL OR r.status=:status)
                  AND (:query='' OR se.canonical_name ILIKE :like_query OR oe.canonical_name ILIKE :like_query OR r.predicate ILIKE :like_query)
                ORDER BY r.updated_at DESC LIMIT :limit
            """), {"space_id": space_id, "status": status, "query": query, "like_query": f"%{query}%", "limit": limit})).mappings().all()
        grouped: dict[UUID, GraphRelation] = {}
        for row in rows:
            if not acl.can_read_document(row["space_id"], row["acl_snapshot"]):
                continue
            evidence = GraphEvidence(row["id"], row["subject"], row["predicate"], row["object"], row["chunk_id"], row["document_id"], row["version_id"], row["content"], row["title"], row["location"])
            current = grouped.get(row["id"])
            if current is None:
                grouped[row["id"]] = GraphRelation(row["id"], row["space_id"], row["subject_entity_id"], row["subject"], row["subject_type"], row["predicate"], row["object_entity_id"], row["object"], row["object_type"], row["status"], row["confidence"], [evidence])
            else:
                grouped[row["id"]] = GraphRelation(
                    current.id, current.space_id, current.subject_entity_id, current.subject, current.subject_type,
                    current.predicate, current.object_entity_id, current.object, current.object_type, current.status,
                    current.confidence, [*current.evidence, evidence],
                )
        return list(grouped.values())

    async def reconcile(self, space_id: UUID) -> list[UUID]:
        async with self._engine.begin() as connection:
            await connection.execute(text("""
                UPDATE rag.graph_evidence e SET active=FALSE
                FROM rag.graph_relations r LEFT JOIN app.documents d ON d.id=e.document_id
                LEFT JOIN rag.chunks c ON c.id=e.chunk_id
                WHERE e.relation_id=r.id AND r.space_id=:space_id
                  AND (d.active_version_id IS DISTINCT FROM e.version_id OR d.availability <> 'ACTIVE' OR c.is_searchable IS DISTINCT FROM TRUE)
            """), {"space_id": space_id})
            stale = await connection.execute(text("""
                UPDATE rag.graph_relations r SET status='STALE', updated_at=NOW()
                WHERE r.space_id=:space_id AND r.status='PUBLISHED'
                  AND NOT EXISTS (SELECT 1 FROM rag.graph_evidence e WHERE e.relation_id=r.id AND e.active)
                RETURNING r.id
            """), {"space_id": space_id})
        return list(stale.scalars())
