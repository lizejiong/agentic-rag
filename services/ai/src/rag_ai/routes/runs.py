from collections.abc import AsyncIterator
import asyncio
import logging
from uuid import UUID

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse, StreamingResponse

from rag_ai.agent.factory import build_agent
from rag_ai.agent.runner import Agent
from rag_ai.contracts.agent_events import ChatRequest
from rag_ai.models.base import ChatMessage
from rag_ai.retrieval.models import AclSnapshot, SpacePolicy
from rag_ai.runtime.registry import RunAlreadyActiveError, run_registry
from rag_ai.settings import get_worker_settings
from rag_ai.streaming.ndjson import encode_ndjson

router = APIRouter(prefix="/v1/agent/runs", tags=["agent-runs"])
logger = logging.getLogger(__name__)

_agent: Agent | None = None


def _get_agent() -> Agent:
    global _agent  # noqa: PLW0603
    if _agent is None:
        _agent = build_agent(get_worker_settings())
    return _agent


def _build_acl(snapshot: dict) -> AclSnapshot:
    return AclSnapshot(
        user_id=UUID(snapshot["userId"]),
        admin=snapshot.get("admin", False),
        group_ids=[UUID(gid) for gid in snapshot.get("groupIds", [])],
        department_id=UUID(snapshot["departmentId"]) if snapshot.get("departmentId") else None,
        spaces={
            UUID(sid): perm
            for sid, perm in snapshot.get("spaces", {}).items()
            if perm in {"VIEW", "EDIT", "MANAGE"}
        },
    )


async def _load_space_policies(space_ids: list[UUID], acl: AclSnapshot) -> list[SpacePolicy]:
    """Load per-space capability flags from PostgreSQL.

    This keeps NestJS as the authorization source while letting Python decide
    retrieval strategy based on space configuration.
    """
    from sqlalchemy import create_engine, text

    settings = get_worker_settings()
    allowed_space_ids = [sid for sid in space_ids if acl.can_view_space(sid)]
    policies: list[SpacePolicy] = []
    if not allowed_space_ids:
        return policies

    def load_rows():
        engine = create_engine(settings.sqlalchemy_url, pool_pre_ping=True)
        try:
            with engine.connect() as connection:
                result = connection.execute(
                    text(
                        """
                        SELECT id, embedding_enabled, reranker_enabled, llm_enabled
                        FROM app.knowledge_spaces
                        WHERE id = ANY(:space_ids)
                        """
                    ),
                    {"space_ids": allowed_space_ids},
                )
                return result.mappings().all()
        finally:
            engine.dispose()

    rows = await asyncio.to_thread(load_rows)

    for row in rows:
        policies.append(
            SpacePolicy(
                space_id=row["id"],
                embedding_enabled=row["embedding_enabled"],
                reranker_enabled=row["reranker_enabled"],
                llm_enabled=row["llm_enabled"],
            )
        )
    return policies


@router.post("")
async def run_agent(request: ChatRequest) -> StreamingResponse:
    try:
        cancellation_event = run_registry.acquire(request.requestId)
    except RunAlreadyActiveError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error

    agent = _get_agent()
    acl = _build_acl(request.aclSnapshot)
    policies = await _load_space_policies(request.selectedSpaceIds, acl)
    # NestJS has already loaded only the currently authorized, persisted
    # history for this conversation. Redis is not a second source of truth.
    history = [
        ChatMessage(role=message.role, content=message.content)
        for message in request.history
    ]

    async def stream() -> AsyncIterator[bytes]:
        try:
            async for event in agent.run(
                request_id=request.requestId,
                trace_id=request.traceId,
                actor_id=request.actorId,
                query=request.question,
                selected_space_ids=request.selectedSpaceIds,
                acl=acl,
                policies=policies,
                history=history,
                cancelled=cancellation_event,
            ):
                yield encode_ndjson(event)
        except Exception:
            logger.exception("AI run failed", extra={"request_id": str(request.requestId)})
            raise
        finally:
            run_registry.release(request.requestId, cancellation_event)

    return StreamingResponse(stream(), media_type="application/x-ndjson")


@router.delete("/{request_id}", status_code=202)
async def cancel_run(request_id: UUID) -> JSONResponse:
    run_registry.cancel(request_id)
    return JSONResponse(status_code=202, content={"status": "cancelling"})
