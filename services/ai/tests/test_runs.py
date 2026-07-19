import json
from uuid import UUID

from starlette.testclient import TestClient

from rag_ai.main import app
from rag_ai.runtime.registry import run_registry

REQUEST_ID = "00000000-0000-4000-8000-000000000001"


def test_run_streams_ordered_ndjson_events() -> None:
    client = TestClient(app)
    payload = {
        "requestId": REQUEST_ID,
        "traceId": "trace-test",
        "actorId": "actor-test",
        "question": "请给我一个可取消流的例子",
        "selectedSpaceIds": [],
    }

    with client.stream("POST", "/v1/agent/runs", json=payload) as response:
        events = [json.loads(line) for line in response.iter_lines() if line]

    assert response.headers["content-type"].startswith("application/x-ndjson")
    assert [event["seq"] for event in events] == list(range(len(events)))
    assert events[0]["type"] == "run.started"
    assert events[-1] == {**events[-1], "type": "run.completed", "finishReason": "stop"}
    assert any(event["type"] == "citation" for event in events)


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
    }

    try:
        response = client.post("/v1/agent/runs", json=payload)
    finally:
        run_registry.release(request_id, active)

    assert response.status_code == 409
    assert response.json() == {"detail": "REQUEST_ALREADY_RUNNING"}
