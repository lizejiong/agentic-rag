from __future__ import annotations

import json
from collections.abc import Mapping
from typing import Any, cast
from uuid import UUID

from neo4j import AsyncDriver
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from rag_ai.graph.extractor import extract_candidates
from rag_ai.graph.models import GraphRelation
from rag_ai.graph.repository import GraphRepository
from rag_ai.models.base import ChatModel
from rag_ai.retrieval.models import AclSnapshot


def _relation_snapshot(row: Any) -> dict[str, object]:
    return {
        "status": str(row["status"]),
        "origin": str(row["origin"]),
        "predicate": str(row["predicate"]),
        "subjectEntityId": str(row["subject_entity_id"]),
        "objectEntityId": str(row["object_entity_id"]),
    }


class GraphService:
    def __init__(self, engine: AsyncEngine, model: ChatModel, *, driver: AsyncDriver | None, extraction_version: str) -> None:
        self._engine = engine
        self._model = model
        self._repository = GraphRepository(engine, driver)
        self._driver = driver
        self._extraction_version = extraction_version

    async def extract_version(self, version_id: UUID) -> int:
        async with self._engine.connect() as connection:
            rows = (await connection.execute(text("""
                SELECT c.id, c.content, c.location, c.document_id, c.version_id, c.space_id
                FROM rag.chunks c JOIN app.knowledge_spaces s ON s.id=c.space_id
                WHERE c.version_id=:version_id AND c.is_searchable=TRUE AND s.graph_extraction_enabled=TRUE
                ORDER BY c.chunk_index
            """), {"version_id": version_id})).mappings().all()
        if not rows:
            return 0
        candidates = {row["id"]: await extract_candidates(row["content"], self._model) for row in rows}
        return await self._repository.save_candidates(
            space_id=rows[0]["space_id"], document_id=rows[0]["document_id"], version_id=version_id,
            extraction_version=self._extraction_version, chunks=[dict(row) for row in rows], candidates_by_chunk=candidates,
        )

    async def list_relations(self, space_id: UUID, acl: AclSnapshot, *, status: str | None, query: str, limit: int) -> list[GraphRelation]:
        for relation_id in await self._repository.reconcile(space_id):
            await self._remove_projection(relation_id)
        return await self._repository.list_relations(space_id, acl, status=status, query=query, limit=limit)

    async def publish(self, relation_id: UUID, space_id: UUID, actor_id: UUID) -> GraphRelation:
        async with self._engine.begin() as connection:
            row = (await connection.execute(text("""
                SELECT r.id AS relation_id, r.space_id, r.status, r.origin, r.revision, r.predicate, r.subject_entity_id, r.object_entity_id, se.id AS subject_id, se.canonical_name AS subject, se.entity_type AS subject_type,
                       oe.id AS object_id, oe.canonical_name AS object, oe.entity_type AS object_type
                FROM rag.graph_relations r JOIN rag.graph_entities se ON se.id=r.subject_entity_id JOIN rag.graph_entities oe ON oe.id=r.object_entity_id
                WHERE r.id=:relation_id AND r.space_id=:space_id FOR UPDATE
            """), {"relation_id": relation_id, "space_id": space_id})).mappings().one()
            evidence_count = (await connection.execute(text("""
                SELECT count(*) FROM rag.graph_evidence e JOIN rag.chunks c ON c.id=e.chunk_id JOIN app.documents d ON d.id=e.document_id
                WHERE e.relation_id=:relation_id AND e.active=TRUE AND c.is_searchable=TRUE AND d.active_version_id=e.version_id AND d.availability='ACTIVE'
            """), {"relation_id": relation_id})).scalar_one()
            if not evidence_count:
                raise ValueError("GRAPH_RELATION_HAS_NO_CURRENT_EVIDENCE")
            revision = row["revision"] + 1
            snapshot = _relation_snapshot(row)
            await connection.execute(text("""
                INSERT INTO rag.graph_revisions (space_id, relation_id, revision, action, actor_id, snapshot)
                VALUES (:space_id, :relation_id, :revision, 'PUBLISH', :actor_id, CAST(:snapshot AS jsonb))
            """), {"space_id": row["space_id"], "relation_id": relation_id, "revision": revision, "actor_id": actor_id, "snapshot": json.dumps(snapshot)})
            await connection.execute(text("UPDATE rag.graph_relations SET status='PUBLISHED', revision=:revision, updated_at=NOW() WHERE id=:relation_id"), {"revision": revision, "relation_id": relation_id})
            await connection.execute(text("UPDATE rag.graph_entities SET status='PUBLISHED', updated_at=NOW() WHERE id IN (:subject_id, :object_id)"), {"subject_id": row["subject_id"], "object_id": row["object_id"]})
        await self._project(cast(Mapping[str, Any], row))
        relations = await self._repository.list_relations(row["space_id"], AclSnapshot(actor_id, True), status="PUBLISHED", query="", limit=100)
        return next(relation for relation in relations if relation.id == relation_id)

    async def reject(self, relation_id: UUID, space_id: UUID, actor_id: UUID) -> None:
        await self._set_status(relation_id, space_id, actor_id, "REJECTED", "REJECT")
        await self._remove_projection(relation_id)

    async def rollback(self, relation_id: UUID, space_id: UUID, actor_id: UUID) -> None:
        async with self._engine.begin() as connection:
            row = (await connection.execute(text("""
                SELECT r.space_id, r.revision, r.status, r.origin, r.predicate, r.subject_entity_id, r.object_entity_id, gr.snapshot
                FROM rag.graph_relations r JOIN rag.graph_revisions gr ON gr.relation_id=r.id
                WHERE r.id=:relation_id AND r.space_id=:space_id ORDER BY gr.revision DESC LIMIT 1 FOR UPDATE
            """), {"relation_id": relation_id, "space_id": space_id})).mappings().one()
            snapshot = cast(dict[str, object], row["snapshot"])
            restored_status = str(snapshot.get("status", "PENDING_REVIEW"))
            restored_predicate = str(snapshot.get("predicate", row["predicate"]))
            restored_origin = str(snapshot.get("origin", row["origin"]))
            restored_subject_id = UUID(str(snapshot.get("subjectEntityId", row["subject_entity_id"])))
            restored_object_id = UUID(str(snapshot.get("objectEntityId", row["object_entity_id"])))
            revision = row["revision"] + 1
            await connection.execute(text("""
                INSERT INTO rag.graph_revisions (space_id, relation_id, revision, action, actor_id, snapshot)
                VALUES (:space_id, :relation_id, :revision, 'ROLLBACK', :actor_id, CAST(:snapshot AS jsonb))
            """), {"space_id": row["space_id"], "relation_id": relation_id, "revision": revision, "actor_id": actor_id, "snapshot": json.dumps(_relation_snapshot(row))})
            await connection.execute(text("""
                UPDATE rag.graph_relations SET status=:status, origin=:origin, predicate=:predicate,
                  subject_entity_id=:subject_id, object_entity_id=:object_id, revision=:revision, updated_at=NOW()
                WHERE id=:relation_id
            """), {"status": restored_status, "origin": restored_origin, "predicate": restored_predicate, "subject_id": restored_subject_id, "object_id": restored_object_id, "revision": revision, "relation_id": relation_id})
            if restored_status == "PUBLISHED":
                await connection.execute(text("UPDATE rag.graph_entities SET status='PUBLISHED', updated_at=NOW() WHERE id IN (:subject_id, :object_id)"), {"subject_id": restored_subject_id, "object_id": restored_object_id})
        if restored_status == "PUBLISHED":
            await self._project(await self._projection_row(relation_id, space_id))
        else:
            await self._remove_projection(relation_id)

    async def correct_relation(self, relation_id: UUID, space_id: UUID, actor_id: UUID, predicate: str) -> None:
        clean_predicate = " ".join(predicate.split())
        if not clean_predicate or len(clean_predicate) > 120:
            raise ValueError("GRAPH_PREDICATE_INVALID")
        async with self._engine.begin() as connection:
            row = (await connection.execute(text("SELECT space_id, revision, status, origin, predicate, subject_entity_id, object_entity_id FROM rag.graph_relations WHERE id=:relation_id AND space_id=:space_id FOR UPDATE"), {"relation_id": relation_id, "space_id": space_id})).mappings().one()
            revision = row["revision"] + 1
            await connection.execute(text("""
                INSERT INTO rag.graph_revisions (space_id, relation_id, revision, action, actor_id, snapshot)
                VALUES (:space_id, :relation_id, :revision, 'CORRECT', :actor_id, CAST(:snapshot AS jsonb))
            """), {"space_id": row["space_id"], "relation_id": relation_id, "revision": revision, "actor_id": actor_id, "snapshot": json.dumps(_relation_snapshot(row))})
            await connection.execute(text("""
                UPDATE rag.graph_relations SET predicate=:predicate, origin='MANUAL', status='PENDING_REVIEW', revision=:revision, updated_at=NOW()
                WHERE id=:relation_id
            """), {"predicate": clean_predicate, "revision": revision, "relation_id": relation_id})
        await self._remove_projection(relation_id)

    async def merge_entities(self, source_id: UUID, target_id: UUID, space_id: UUID, actor_id: UUID) -> int:
        if source_id == target_id:
            raise ValueError("GRAPH_MERGE_IDENTICAL_ENTITIES")
        async with self._engine.begin() as connection:
            entities = (await connection.execute(text("SELECT id, space_id FROM rag.graph_entities WHERE id IN (:source_id, :target_id) AND space_id=:space_id FOR UPDATE"), {"source_id": source_id, "target_id": target_id, "space_id": space_id})).mappings().all()
            if len(entities) != 2:
                raise ValueError("GRAPH_MERGE_SPACE_MISMATCH")
            relations = (await connection.execute(text("""
                SELECT id, subject_entity_id, object_entity_id, predicate, status, origin, revision
                FROM rag.graph_relations
                WHERE space_id=:space_id AND (subject_entity_id=:source_id OR object_entity_id=:source_id) FOR UPDATE
            """), {"space_id": space_id, "source_id": source_id})).mappings().all()
            relation_ids = [row["id"] for row in relations]
            for row in relations:
                subject_id = target_id if row["subject_entity_id"] == source_id else row["subject_entity_id"]
                object_id = target_id if row["object_entity_id"] == source_id else row["object_entity_id"]
                duplicate = subject_id == object_id or (await connection.execute(text("""
                    SELECT 1 FROM rag.graph_relations
                    WHERE space_id=:space_id AND subject_entity_id=:subject_id AND predicate=:predicate
                      AND object_entity_id=:object_id AND id<>:relation_id LIMIT 1
                """), {"space_id": space_id, "subject_id": subject_id, "predicate": row["predicate"], "object_id": object_id, "relation_id": row["id"]})).scalar_one_or_none() is not None
                revision = row["revision"] + 1
                status = "REJECTED" if duplicate else "PENDING_REVIEW"
                action = "MERGE_REJECT_DUPLICATE" if duplicate else "MERGE"
                if duplicate:
                    await connection.execute(text("""
                        UPDATE rag.graph_relations SET status=:status, origin='MANUAL', revision=:revision, updated_at=NOW()
                        WHERE id=:relation_id
                    """), {"status": status, "revision": revision, "relation_id": row["id"]})
                else:
                    await connection.execute(text("""
                        UPDATE rag.graph_relations SET subject_entity_id=:subject_id, object_entity_id=:object_id,
                          status=:status, origin='MANUAL', revision=:revision, updated_at=NOW() WHERE id=:relation_id
                    """), {"subject_id": subject_id, "object_id": object_id, "status": status, "revision": revision, "relation_id": row["id"]})
                await connection.execute(text("""
                    INSERT INTO rag.graph_revisions (space_id, relation_id, revision, action, actor_id, snapshot)
                    VALUES (:space_id, :relation_id, :revision, :action, :actor_id, CAST(:snapshot AS jsonb))
                """), {"space_id": space_id, "relation_id": row["id"], "revision": revision, "action": action, "actor_id": actor_id, "snapshot": json.dumps({**_relation_snapshot(row), "mergedEntityId": str(source_id), "targetEntityId": str(target_id)})})
            await connection.execute(text("UPDATE rag.graph_entities SET status='REJECTED', updated_at=NOW() WHERE id=:source_id"), {"source_id": source_id})
        for relation_id in relation_ids:
            await self._remove_projection(relation_id)
        return len(relation_ids)

    async def split_entity(self, source_id: UUID, space_id: UUID, actor_id: UUID, entities: list[tuple[str, str, list[UUID]]]) -> int:
        if not entities:
            raise ValueError("GRAPH_SPLIT_ENTITIES_REQUIRED")
        moved = 0
        moved_relation_ids: list[UUID] = []
        async with self._engine.begin() as connection:
            source = (await connection.execute(text("SELECT space_id FROM rag.graph_entities WHERE id=:source_id AND space_id=:space_id FOR UPDATE"), {"source_id": source_id, "space_id": space_id})).mappings().one()
            for name, entity_type, relation_ids in entities:
                result = await connection.execute(text("""
                    INSERT INTO rag.graph_entities (space_id, canonical_name, entity_type, status, origin)
                    VALUES (:space_id, :name, :entity_type, 'PENDING_REVIEW', 'MANUAL') RETURNING id
                """), {"space_id": source["space_id"], "name": " ".join(name.split()), "entity_type": entity_type})
                entity_id = result.scalar_one()
                for relation_id in relation_ids:
                    before = (await connection.execute(text("""
                        SELECT status, origin, predicate, subject_entity_id, object_entity_id
                        FROM rag.graph_relations
                        WHERE id=:relation_id AND space_id=:space_id AND (subject_entity_id=:source_id OR object_entity_id=:source_id)
                        FOR UPDATE
                    """), {"relation_id": relation_id, "space_id": space_id, "source_id": source_id})).mappings().one_or_none()
                    if before is None:
                        continue
                    updated = await connection.execute(text("""
                        UPDATE rag.graph_relations SET subject_entity_id=CASE WHEN subject_entity_id=:source_id THEN :entity_id ELSE subject_entity_id END,
                          object_entity_id=CASE WHEN object_entity_id=:source_id THEN :entity_id ELSE object_entity_id END,
                          status='PENDING_REVIEW', origin='MANUAL', revision=revision+1, updated_at=NOW()
                        WHERE id=:relation_id AND space_id=:space_id AND (subject_entity_id=:source_id OR object_entity_id=:source_id)
                        RETURNING id, revision
                    """), {"source_id": source_id, "entity_id": entity_id, "relation_id": relation_id, "space_id": space_id})
                    row = updated.mappings().one_or_none()
                    if row is not None:
                        await connection.execute(text("""
                            INSERT INTO rag.graph_revisions (space_id, relation_id, revision, action, actor_id, snapshot)
                            VALUES (:space_id, :relation_id, :revision, 'SPLIT', :actor_id, CAST(:snapshot AS jsonb))
                        """), {"space_id": space_id, "relation_id": relation_id, "revision": row["revision"], "actor_id": actor_id, "snapshot": json.dumps({**_relation_snapshot(before), "sourceEntityId": str(source_id), "newEntityId": str(entity_id)})})
                        moved += 1
                        moved_relation_ids.append(relation_id)
        for relation_id in moved_relation_ids:
            await self._remove_projection(relation_id)
        return moved

    async def find_paths(self, space_id: UUID, source_id: UUID, target_id: UUID, acl: AclSnapshot, max_hops: int = 3) -> list[list[GraphRelation]]:
        if self._driver is None:
            return []
        hop_pattern = {1: "*1..1", 2: "*1..2", 3: "*1..3"}.get(max_hops)
        if hop_pattern is None:
            raise ValueError("GRAPH_MAX_HOPS_INVALID")
        async with self._driver.session() as session:
            result = await session.run(f"""
                MATCH p=(source:PublishedEntity {{id:$source_id, space_id:$space_id}})-[:PUBLISHED_RELATION{hop_pattern}]-(target:PublishedEntity {{id:$target_id, space_id:$space_id}})
                RETURN [relation IN relationships(p) | relation.id] AS relation_ids LIMIT 20
            """, source_id=str(source_id), target_id=str(target_id), space_id=str(space_id))
            rows = await result.data()
        visible = {str(item.id): item for item in await self._repository.list_relations(space_id, acl, status="PUBLISHED", query="", limit=500)}
        return [
            [visible[relation_id] for relation_id in row["relation_ids"]]
            for row in rows
            if all(relation_id in visible for relation_id in row["relation_ids"])
        ]

    async def _set_status(self, relation_id: UUID, space_id: UUID, actor_id: UUID, status: str, action: str) -> Mapping[str, Any]:
        async with self._engine.begin() as connection:
            row = (await connection.execute(text("SELECT space_id, revision, status, origin, predicate, subject_entity_id, object_entity_id FROM rag.graph_relations WHERE id=:relation_id AND space_id=:space_id FOR UPDATE"), {"relation_id": relation_id, "space_id": space_id})).mappings().one()
            revision = row["revision"] + 1
            await connection.execute(text("""
                INSERT INTO rag.graph_revisions (space_id, relation_id, revision, action, actor_id, snapshot)
                VALUES (:space_id, :relation_id, :revision, :action, :actor_id, CAST(:snapshot AS jsonb))
            """), {"space_id": row["space_id"], "relation_id": relation_id, "revision": revision, "action": action, "actor_id": actor_id, "snapshot": json.dumps(_relation_snapshot(row))})
            await connection.execute(text("UPDATE rag.graph_relations SET status=:status, revision=:revision, updated_at=NOW() WHERE id=:relation_id"), {"status": status, "revision": revision, "relation_id": relation_id})
        return cast(Mapping[str, Any], dict(row))

    async def _projection_row(self, relation_id: UUID, space_id: UUID) -> Mapping[str, Any]:
        async with self._engine.connect() as connection:
            row = (await connection.execute(text("""
                SELECT r.id AS relation_id, r.space_id, r.predicate, se.id AS subject_id, se.canonical_name AS subject,
                  se.entity_type AS subject_type, oe.id AS object_id, oe.canonical_name AS object, oe.entity_type AS object_type
                FROM rag.graph_relations r JOIN rag.graph_entities se ON se.id=r.subject_entity_id
                JOIN rag.graph_entities oe ON oe.id=r.object_entity_id
                WHERE r.id=:relation_id AND r.space_id=:space_id AND r.status='PUBLISHED'
            """), {"relation_id": relation_id, "space_id": space_id})).mappings().one()
        return cast(Mapping[str, Any], dict(row))

    async def _project(self, row: Mapping[str, Any]) -> None:
        if self._driver is None:
            return
        async with self._driver.session() as session:
            await session.run("""
                MERGE (s:PublishedEntity {id: $subject_id, space_id: $space_id}) SET s.name=$subject, s.entity_type=$subject_type
                MERGE (o:PublishedEntity {id: $object_id, space_id: $space_id}) SET o.name=$object, o.entity_type=$object_type
                MERGE (s)-[r:PUBLISHED_RELATION {id: $relation_id}]->(o) SET r.predicate=$predicate
            """, parameters=dict(row))

    async def _remove_projection(self, relation_id: UUID) -> None:
        if self._driver is None:
            return
        async with self._driver.session() as session:
            await session.run("MATCH ()-[relation:PUBLISHED_RELATION {id:$relation_id}]-() DELETE relation", relation_id=str(relation_id))
