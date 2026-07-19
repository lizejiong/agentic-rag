import json

from starlette.testclient import TestClient

from rag_ai.main import app

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

    first_response = client.post(f"/v1/agent/runs/{REQUEST_ID}/cancel")
    second_response = client.post(f"/v1/agent/runs/{REQUEST_ID}/cancel")

    assert first_response.status_code == 202
    assert first_response.json() == {"status": "cancelling"}
    assert second_response.status_code == 202
    assert second_response.json() == {"status": "cancelling"}
