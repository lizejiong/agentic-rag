import asyncio
import json
from uuid import UUID

import pytest
from pydantic import ValidationError
from starlette.testclient import TestClient

from rag_ai.contracts.agent_events import ChatRequest
from rag_ai.main import app
from rag_ai.routes import runs as runs_module
from rag_ai.routes.runs import cancel_run
from rag_ai.runtime.fake_agent import fake_agent_events
from rag_ai.runtime.registry import run_registry

REQUEST_ID = "00000000-0000-4000-8000-000000000001"


def _minimal_payload() -> dict:
    return {
        "requestId": REQUEST_ID,
        "traceId": "trace-test",
        "actorId": "actor-test",
        "question": "请给我一个可取消流的例子",
        "selectedSpaceIds": [],
        "aclSnapshot": {
            "userId": "00000000-0000-4000-8000-000000000001",
            "admin": False,
            "groupIds": [],
            "spaces": {},
        },
        "history": [],
    }


class FakeAgent:
    last_history = None
    last_history_summary = None

    async def run(self, **kwargs):  # noqa: ANN003,ARG002
        self.last_history = kwargs["history"]
        self.last_history_summary = kwargs["history_summary"]
        request_id = UUID(REQUEST_ID)
        cancelled = asyncio.Event()
        async for event in fake_agent_events(
            ChatRequest(
                requestId=request_id,
                traceId="trace-test",
                actorId="actor-test",
                question="fake",
                selectedSpaceIds=[],
                aclSnapshot={},
                history=[],
            ),
            cancelled,
        ):
            yield event


def test_run_streams_ordered_ndjson_events() -> None:
    agent = FakeAgent()
    runs_module._agent = agent
    client = TestClient(app)

    with client.stream("POST", "/v1/agent/runs", json=_minimal_payload()) as response:
        events = [json.loads(line) for line in response.iter_lines() if line]

    assert response.headers["content-type"].startswith("application/x-ndjson")
    assert [event["seq"] for event in events] == list(range(len(events)))
    assert events[0]["type"] == "run.started"
    assert events[-1] == {**events[-1], "type": "run.completed", "finishReason": "stop"}
    assert any(event["type"] == "citation" for event in events)


def test_run_uses_only_history_received_from_api() -> None:
    agent = FakeAgent()
    runs_module._agent = agent
    payload = _minimal_payload()
    payload["history"] = [
        {"role": "user", "content": "persisted question"},
        {"role": "assistant", "content": "persisted answer"},
    ]
    client = TestClient(app)

    response = client.post("/v1/agent/runs", json=payload)

    assert response.status_code == 200
    assert agent.last_history is not None
    assert [(message.role, message.content) for message in agent.last_history] == [
        ("user", "persisted question"),
        ("assistant", "persisted answer"),
    ]


def test_run_accepts_history_summary_from_api() -> None:
    agent = FakeAgent()
    runs_module._agent = agent
    payload = _minimal_payload()
    payload["historySummary"] = "此前已授权的用户话题：\\n- earlier question"
    client = TestClient(app)

    response = client.post("/v1/agent/runs", json=payload)

    assert response.status_code == 200
    assert ChatRequest.model_validate(payload).historySummary == payload["historySummary"]
    assert agent.last_history_summary == payload["historySummary"]


def test_history_summary_uses_a_unicode_code_point_limit() -> None:
    payload = _minimal_payload()
    payload["historySummary"] = "😀" * 4000

    assert ChatRequest.model_validate(payload).historySummary == payload["historySummary"]
    with pytest.raises(ValidationError):
        ChatRequest.model_validate({**payload, "historySummary": "😀" * 4001})


def test_cancel_is_idempotent() -> None:
    client = TestClient(app)

    first_response = client.delete(f"/v1/agent/runs/{REQUEST_ID}")
    second_response = client.delete(f"/v1/agent/runs/{REQUEST_ID}")

    assert first_response.status_code == 202
    assert first_response.json() == {"status": "cancelling"}
    assert second_response.status_code == 202
    assert second_response.json() == {"status": "cancelling"}


def test_duplicate_active_run_returns_conflict_before_streaming() -> None:
    client = TestClient(app)
    request_id = UUID("00000000-0000-4000-8000-000000000024")
    active = run_registry.acquire(request_id)
    payload = {
        "requestId": str(request_id),
        "traceId": "trace-duplicate",
        "actorId": "actor-test",
        "question": "重复运行",
        "selectedSpaceIds": [],
        "aclSnapshot": {
            "userId": "00000000-0000-4000-8000-000000000001",
            "admin": False,
            "groupIds": [],
            "spaces": {},
        },
        "history": [],
    }

    try:
        response = client.post("/v1/agent/runs", json=payload)
    finally:
        run_registry.release(request_id, active)

    assert response.status_code == 409
    assert response.json() == {"detail": "REQUEST_ALREADY_RUNNING"}


@pytest.mark.asyncio
async def test_cancel_route_stops_an_active_generator() -> None:
    request_id = UUID("00000000-0000-4000-8000-000000000025")
    request = ChatRequest(
        requestId=request_id,
        traceId="trace-cancel",
        actorId="actor-test",
        question="验证取消传播",
        selectedSpaceIds=[],
        aclSnapshot={},
        history=[],
    )
    cancelled = run_registry.acquire(request_id)
    events = []

    try:
        stream = fake_agent_events(request, cancelled)
        async for event in stream:
            events.append(event)
            if event.type == "text.delta":
                response = await cancel_run(request_id)
                assert response.status_code == 202
    finally:
        run_registry.release(request_id, cancelled)

    assert events[-1].type == "run.completed"
    assert events[-1].finishReason == "cancelled"
