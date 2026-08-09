from __future__ import annotations

from dataclasses import dataclass
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

GraphStatus = Literal["PENDING_REVIEW", "PUBLISHED", "REJECTED", "STALE"]


class GraphRelationCandidate(BaseModel):
    subject: str = Field(min_length=1, max_length=240)
    subject_type: str = Field(min_length=1, max_length=80)
    predicate: str = Field(min_length=1, max_length=120)
    object: str = Field(min_length=1, max_length=240)
    object_type: str = Field(min_length=1, max_length=80)
    quote: str = Field(min_length=1, max_length=1200)
    confidence: float = Field(ge=0, le=1)


@dataclass(frozen=True)
class GraphEvidence:
    relation_id: UUID
    subject: str
    predicate: str
    object_name: str
    chunk_id: UUID
    document_id: UUID
    version_id: UUID
    content: str
    title: str
    location: dict[str, object]


@dataclass(frozen=True)
class GraphRelation:
    id: UUID
    space_id: UUID
    subject_entity_id: UUID
    subject: str
    subject_type: str
    predicate: str
    object_entity_id: UUID
    object: str
    object_type: str
    status: GraphStatus
    confidence: float | None
    evidence: list[GraphEvidence]
