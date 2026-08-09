from __future__ import annotations

from typing import Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from rag_ai.graph.factory import build_graph_service
from rag_ai.graph.models import GraphRelation
from rag_ai.retrieval.models import AclSnapshot
from rag_ai.settings import get_worker_settings

router = APIRouter(prefix="/v1/graph", tags=["graph"])
_service = None


class QueryInput(BaseModel):
    actor_id: UUID = Field(alias="actorId")
    acl_snapshot: dict[str, object] = Field(alias="aclSnapshot")
    status: Literal["PENDING_REVIEW", "PUBLISHED", "REJECTED", "STALE"] | None = None
    query: str = ""
    limit: int = Field(default=20, ge=1, le=50)


class PublishInput(QueryInput):
    manage: bool = False
    space_id: UUID = Field(alias="spaceId")


class CorrectInput(PublishInput):
    predicate: str = Field(min_length=1, max_length=120)


class MergeInput(PublishInput):
    target_entity_id: UUID = Field(alias="targetEntityId")


class SplitPart(BaseModel):
    name: str = Field(min_length=1, max_length=240)
    entity_type: str = Field(alias="entityType", min_length=1, max_length=80)
    relation_ids: list[UUID] = Field(alias="relationIds", min_length=1)


class SplitInput(PublishInput):
    entities: list[SplitPart] = Field(min_length=1)


def _graph_service():
    global _service
    if _service is None:
        _service = build_graph_service(get_worker_settings())
    return _service


def _acl(actor_id: UUID, raw: dict[str, object]) -> AclSnapshot:
    raw_groups = raw.get("groupIds", [])
    raw_spaces = raw.get("spaces", {})
    return AclSnapshot(
        user_id=actor_id, admin=bool(raw.get("admin", False)),
        group_ids=[UUID(str(value)) for value in raw_groups] if isinstance(raw_groups, list) else [],
        department_id=UUID(str(raw["departmentId"])) if raw.get("departmentId") else None,
        spaces={UUID(key): value for key, value in raw_spaces.items() if value in {"VIEW", "EDIT", "MANAGE"}} if isinstance(raw_spaces, dict) else {},
    )


def _serialize(relation: GraphRelation) -> dict[str, object]:
    return {
        "id": str(relation.id), "spaceId": str(relation.space_id), "subject": relation.subject,
        "subjectEntityId": str(relation.subject_entity_id), "subjectType": relation.subject_type, "predicate": relation.predicate, "objectEntityId": str(relation.object_entity_id), "object": relation.object,
        "objectType": relation.object_type, "status": relation.status, "confidence": relation.confidence,
        "evidence": [{"chunkId": str(item.chunk_id), "documentId": str(item.document_id), "versionId": str(item.version_id), "title": item.title, "quote": item.content, "location": item.location} for item in relation.evidence],
    }


@router.post("/spaces/{space_id}/relations:query")
async def query_relations(space_id: UUID, input: QueryInput) -> dict[str, object]:
    acl = _acl(input.actor_id, input.acl_snapshot)
    if not acl.can_view_space(space_id):
        raise HTTPException(status_code=403, detail="GRAPH_SPACE_FORBIDDEN")
    relations = await _graph_service().list_relations(space_id, acl, status=input.status, query=input.query, limit=input.limit)
    return {"relations": [_serialize(relation) for relation in relations]}


@router.post("/relations/{relation_id}:publish")
async def publish_relation(relation_id: UUID, input: PublishInput) -> dict[str, object]:
    if not input.manage:
        raise HTTPException(status_code=403, detail="GRAPH_MANAGE_REQUIRED")
    try:
        return _serialize(await _graph_service().publish(relation_id, input.space_id, input.actor_id))
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


@router.post("/relations/{relation_id}:reject", status_code=204)
async def reject_relation(relation_id: UUID, input: PublishInput) -> None:
    if not input.manage:
        raise HTTPException(status_code=403, detail="GRAPH_MANAGE_REQUIRED")
    await _graph_service().reject(relation_id, input.space_id, input.actor_id)


@router.post("/relations/{relation_id}:rollback", status_code=204)
async def rollback_relation(relation_id: UUID, input: PublishInput) -> None:
    if not input.manage:
        raise HTTPException(status_code=403, detail="GRAPH_MANAGE_REQUIRED")
    await _graph_service().rollback(relation_id, input.space_id, input.actor_id)


@router.post("/relations/{relation_id}:correct", status_code=204)
async def correct_relation(relation_id: UUID, input: CorrectInput) -> None:
    if not input.manage:
        raise HTTPException(status_code=403, detail="GRAPH_MANAGE_REQUIRED")
    await _graph_service().correct_relation(relation_id, input.space_id, input.actor_id, input.predicate)


@router.post("/entities/{entity_id}:merge", status_code=204)
async def merge_entity(entity_id: UUID, input: MergeInput) -> None:
    if not input.manage:
        raise HTTPException(status_code=403, detail="GRAPH_MANAGE_REQUIRED")
    await _graph_service().merge_entities(entity_id, input.target_entity_id, input.space_id, input.actor_id)


@router.post("/entities/{entity_id}:split")
async def split_entity(entity_id: UUID, input: SplitInput) -> dict[str, int]:
    if not input.manage:
        raise HTTPException(status_code=403, detail="GRAPH_MANAGE_REQUIRED")
    moved = await _graph_service().split_entity(entity_id, input.space_id, input.actor_id, [(item.name, item.entity_type, item.relation_ids) for item in input.entities])
    return {"movedRelations": moved}


class PathInput(QueryInput):
    source_id: UUID = Field(alias="sourceId")
    target_id: UUID = Field(alias="targetId")
    max_hops: int = Field(alias="maxHops", default=3, ge=1, le=3)


@router.post("/spaces/{space_id}/paths:query")
async def query_paths(space_id: UUID, input: PathInput) -> dict[str, object]:
    acl = _acl(input.actor_id, input.acl_snapshot)
    if not acl.can_view_space(space_id):
        raise HTTPException(status_code=403, detail="GRAPH_SPACE_FORBIDDEN")
    paths = await _graph_service().find_paths(space_id, input.source_id, input.target_id, acl, input.max_hops)
    return {"paths": [[_serialize(relation) for relation in path] for path in paths if path]}
