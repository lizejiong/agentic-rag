from collections.abc import AsyncIterator
from uuid import UUID

from fastapi import APIRouter
from fastapi.responses import JSONResponse, StreamingResponse

from rag_ai.contracts.agent_events import RunRequest
from rag_ai.runtime.fake_agent import fake_agent_events
from rag_ai.runtime.registry import run_registry
from rag_ai.streaming.ndjson import encode_ndjson

router = APIRouter(prefix="/v1/agent/runs", tags=["agent-runs"])


@router.post("")
async def run_agent(request: RunRequest) -> StreamingResponse:
    cancellation_event = run_registry.event_for(request.requestId)

    async def stream() -> AsyncIterator[bytes]:
        try:
            async for event in fake_agent_events(request, cancellation_event):
                yield encode_ndjson(event)
        finally:
            run_registry.release(request.requestId)

    return StreamingResponse(stream(), media_type="application/x-ndjson")


@router.post("/{request_id}/cancel", status_code=202)
async def cancel_run(request_id: UUID) -> JSONResponse:
    run_registry.cancel(request_id)
    return JSONResponse(status_code=202, content={"status": "cancelling"})
