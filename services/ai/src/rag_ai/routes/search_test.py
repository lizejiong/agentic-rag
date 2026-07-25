"""Search test playground — standalone retrieval debug endpoint."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from rag_ai.agent.factory import build_retrieval_service
from rag_ai.models.base import ChatMessage
from rag_ai.retrieval.models import AclSnapshot, SpacePolicy
from rag_ai.routes.runs import _build_acl, _load_space_policies
from rag_ai.settings import get_worker_settings

router = APIRouter(prefix="/v1/retrieval", tags=["search-test"])

_retrieval_service = None


def _get_retrieval_service():
    global _retrieval_service
    if _retrieval_service is None:
        _retrieval_service = build_retrieval_service(get_worker_settings())
    return _retrieval_service


class SearchTestRequest(BaseModel):
    query: str
    selectedSpaceIds: list[UUID]
    aclSnapshot: dict
    maxResults: int = 10


class SearchTestChunk(BaseModel):
    chunkId: str
    documentId: str
    documentTitle: str
    content: str
    score: float
    path: str  # "vector" | "lexical" | "reranked"
    location: dict | None = None


class SearchTestResponse(BaseModel):
    query: str
    totalResults: int
    results: list[SearchTestChunk]


@router.post("/test", response_model=SearchTestResponse)
async def search_test(request: SearchTestRequest) -> SearchTestResponse:
    if not request.selectedSpaceIds:
        raise HTTPException(status_code=400, detail="At least one space required")

    acl = _build_acl(request.aclSnapshot)
    policies = await _load_space_policies(request.selectedSpaceIds, acl)

    service = _get_retrieval_service()
    try:
        summary, chunks = await service.retrieve(
            query=request.query,
            space_ids=[str(sid) for sid in request.selectedSpaceIds],
            acl=acl,
            policies=policies,
            top_k=request.maxResults,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    results: list[SearchTestChunk] = []
    for chunk in chunks:
        location = None
        if chunk.location:
            location = {
                "page": chunk.location.page,
                "slide": chunk.location.slide,
                "sheet": chunk.location.sheet,
            }
        results.append(
            SearchTestChunk(
                chunkId=str(chunk.chunk_id),
                documentId=str(chunk.document_id),
                documentTitle=chunk.document_title or "",
                content=chunk.content[:500],
                score=round(chunk.score, 4),
                path=chunk.source.value if chunk.source else "unknown",
                location=location,
            )
        )

    return SearchTestResponse(
        query=request.query,
        totalResults=len(results),
        results=results,
    )
