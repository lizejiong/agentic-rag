from collections.abc import AsyncIterator
from uuid import UUID

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse, StreamingResponse

from rag_ai.agent.factory import build_agent, build_memory_store
from rag_ai.agent.runner import Agent
from rag_ai.contracts.agent_events import ChatRequest
from rag_ai.memory.session_memory import RedisSessionMemoryStore
from rag_ai.models.base import ChatMessage
from rag_ai.retrieval.models import AclSnapshot, SpacePolicy
from rag_ai.runtime.registry import RunAlreadyActiveError, run_registry
from rag_ai.settings import get_worker_settings
from rag_ai.streaming.ndjson import encode_ndjson

router = APIRouter(prefix="/v1/agent/runs", tags=["agent-runs"])

_agent: Agent | None = None
_memory_store: RedisSessionMemoryStore | None = None


def _get_agent() -> Agent:
    global _agent  # noqa: PLW0603
    if _agent is None:
        _agent = build_agent(get_worker_settings())
    return _agent


def _get_memory_store() -> RedisSessionMemoryStore:
    global _memory_store  # noqa: PLW0603
    if _memory_store is None:
        _memory_store = build_memory_store(get_worker_settings())
    return _memory_store


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
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import create_async_engine

    settings = get_worker_settings()
    engine = create_async_engine(settings.async_sqlalchemy_url, pool_pre_ping=True)
    allowed_space_ids = [sid for sid in space_ids if acl.can_view_space(sid)]
    policies: list[SpacePolicy] = []
    if not allowed_space_ids:
        return policies

    async with engine.connect() as connection:
        result = await connection.execute(
            text(
                """
                SELECT id, embedding_enabled, reranker_enabled, llm_enabled
                FROM app.knowledge_spaces
                WHERE id = ANY(:space_ids)
                """
            ),
            {"space_ids": [str(sid) for sid in allowed_space_ids]},
        )
        rows = result.mappings().all()
    await engine.dispose()

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
    memory_store = _get_memory_store()

    # Hydrate history from the request (recent turns from NestJS) and merge
    # with persisted session memory when available.
    request_history = [
        ChatMessage(role=message.role, content=message.content)
        for message in request.history
    ]
    session_memory = None
    if request.sessionId:
        try:
            session_memory = await memory_store.load(request.actorId, request.sessionId)
        except Exception:
            # Memory is best-effort; do not fail the run.
            session_memory = None

    if session_memory and session_memory.messages:
        # Deduplicate: request_history is the freshest, append older turns from
        # persisted memory that aren't already in the request.
        request_texts = {(message.role, message.content) for message in request_history}
        merged = list(request_history)
        for message in session_memory.messages:
            if (message.role, message.content) not in request_texts:
                merged.append(message)
        history = merged
    else:
        history = request_history

    async def stream() -> AsyncIterator[bytes]:
        answer_parts: list[str] = []
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
                if event.type == "text.delta":
                    answer_parts.append(event.text)
        finally:
            run_registry.release(request.requestId, cancellation_event)
            # Persist this turn to session memory (best-effort).
            if request.sessionId and answer_parts:
                try:
                    answer_text = "".join(answer_parts)
                    await memory_store.append_turn(
                        user_id=request.actorId,
                        session_id=request.sessionId,
                        user_message=request.question,
                        assistant_message=answer_text,
                    )
                except Exception:
                    # Memory persistence failure must not break the HTTP response.
                    pass

    return StreamingResponse(stream(), media_type="application/x-ndjson")


@router.delete("/{request_id}", status_code=202)
async def cancel_run(request_id: UUID) -> JSONResponse:
    run_registry.cancel(request_id)
    return JSONResponse(status_code=202, content={"status": "cancelling"})
