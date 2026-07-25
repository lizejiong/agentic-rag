from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal
from uuid import UUID


@dataclass(frozen=True)
class CitationLocation:
    page: int | None = None
    slide: int | None = None
    sheet: str | None = None
    cell_range: str | None = None


@dataclass(frozen=True)
class RetrievedChunk:
    chunk_id: UUID
    document_id: UUID
    version_id: UUID
    space_id: UUID
    content: str
    title: str
    location: CitationLocation
    score: float
    path: Literal["vector", "lexical", "rrf", "rerank"]
    # Extended context, kept optional so the service can populate it separately.
    context: str = ""
    # Metadata for tracing and debugging.
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class RetrievalPathSummary:
    path: Literal["vector", "lexical"]
    space_id: UUID
    candidates_returned: int
    candidates_after_acl: int | None = None
    error: str | None = None


@dataclass(frozen=True)
class RetrievalSummary:
    query: str
    vector_top_k: int
    lexical_top_k: int
    rrf_k: int
    rrf_top_k: int
    rerank_top_k: int
    reranker_enabled: bool
    paths: list[RetrievalPathSummary] = field(default_factory=list)
    rrf_candidate_count: int = 0
    final_candidate_count: int = 0
    embedding_model: str = ""
    embedding_version: str = ""
    reranker_model: str = ""
    reranker_version: str = ""
    elapsed_ms: float = 0.0


@dataclass(frozen=True)
class SpacePolicy:
    space_id: UUID
    embedding_enabled: bool
    reranker_enabled: bool
    llm_enabled: bool


@dataclass(frozen=True)
class AclSnapshot:
    user_id: UUID
    admin: bool
    group_ids: list[UUID] = field(default_factory=list)
    department_id: UUID | None = None
    spaces: dict[UUID, Literal["VIEW", "EDIT", "MANAGE"]] = field(default_factory=dict)

    def can_view_space(self, space_id: UUID) -> bool:
        return self.admin or space_id in self.spaces

    def can_read_document(self, space_id: UUID, acl_snapshot: dict[str, Any]) -> bool:
        if not self.can_view_space(space_id):
            return False
        if self.admin:
            return True
        subjects = acl_snapshot.get("documentSubjects", []) if isinstance(acl_snapshot, dict) else []
        if not subjects:
            return True
        for subject in subjects:
            subject_type = subject.get("subjectType")
            subject_id = subject.get("subjectId")
            if subject_type == "USER" and str(self.user_id) == subject_id:
                return True
            if subject_type == "DEPARTMENT" and self.department_id is not None:
                if str(self.department_id) == subject_id:
                    return True
            if subject_type == "GROUP" and subject_id in {str(gid) for gid in self.group_ids}:
                return True
        return False


@dataclass(frozen=True)
class RankedChunk:
    chunk: RetrievedChunk
    rrf_score: float | None = None
    rerank_score: float | None = None
