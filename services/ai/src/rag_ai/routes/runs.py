from collections.abc import AsyncIterator
from uuid import UUID

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse, StreamingResponse

from rag_ai.contracts.agent_events import RunRequest
from rag_ai.runtime.fake_agent import fake_agent_events
from rag_ai.runtime.registry import RunAlreadyActiveError, run_registry
from rag_ai.streaming.ndjson import encode_ndjson

router = APIRouter(prefix="/v1/agent/runs", tags=["agent-runs"])


@router.post("")
async def run_agent(request: RunRequest) -> StreamingResponse:
    try:
        cancellation_event = run_registry.acquire(request.requestId)
    except RunAlreadyActiveError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error

    async def stream() -> AsyncIterator[bytes]:
        try:
            async for event in fake_agent_events(request, cancellation_event):
                yield encode_ndjson(event)
        finally:
            run_registry.release(request.requestId, cancellation_event)

    return StreamingResponse(stream(), media_type="application/x-ndjson")


@router.delete("/{request_id}", status_code=202)
async def cancel_run(request_id: UUID) -> JSONResponse:
    run_registry.cancel(request_id)
    return JSONResponse(status_code=202, content={"status": "cancelling"})
