import json
from pathlib import Path
from uuid import UUID

import pytest
from pydantic import TypeAdapter, ValidationError

from rag_ai.contracts.agent_events import AgentEvent, RunRequest

agent_event_adapter: TypeAdapter[AgentEvent] = TypeAdapter(AgentEvent)


def test_agent_event_fixture_matches_contract() -> None:
    fixture_path = Path(__file__).parents[3] / "packages" / "contracts" / "fixtures" / "agent-events.jsonl"

    events = [
        agent_event_adapter.validate_python(json.loads(line))
        for line in fixture_path.read_text(encoding="utf-8").splitlines()
    ]

    assert [event.seq for event in events] == list(range(6))


def test_agent_event_rejects_unknown_fields() -> None:
    payload = {
        "requestId": "00000000-0000-4000-8000-000000000001",
        "traceId": "trace-fixture",
        "seq": 0,
        "occurredAt": "2026-07-18T00:00:00.000Z",
        "type": "run.started",
        "unexpected": True,
    }

    with pytest.raises(ValidationError):
        agent_event_adapter.validate_python(payload)


def test_nested_location_rejects_unknown_fields() -> None:
    payload = {
        "requestId": "00000000-0000-4000-8000-000000000001",
        "traceId": "trace-fixture",
        "seq": 0,
        "occurredAt": "2026-07-18T00:00:00.000Z",
        "type": "citation",
        "citationId": "00000000-0000-4000-8000-000000000002",
        "title": "协议示例文档",
        "snippet": "仅用于测试。",
        "location": {"page": 1, "storageKey": "must-not-leak"},
    }

    with pytest.raises(ValidationError):
        agent_event_adapter.validate_python(payload)


def test_citation_location_rejects_explicit_null() -> None:
    payload = {
        "requestId": "00000000-0000-4000-8000-000000000001",
        "traceId": "trace-fixture",
        "seq": 0,
        "occurredAt": "2026-07-18T00:00:00.000Z",
        "type": "citation",
        "citationId": "00000000-0000-4000-8000-000000000002",
        "title": "协议示例文档",
        "snippet": "仅用于测试。",
        "location": {"page": 1, "slide": None},
    }

    with pytest.raises(ValidationError):
        agent_event_adapter.validate_python(payload)


def test_run_request_is_strict_and_trims_question() -> None:
    request = RunRequest(
        requestId=UUID("00000000-0000-4000-8000-000000000010"),
        traceId="trace-test",
        actorId="actor-test",
        question="  什么是混合检索？  ",
        selectedSpaceIds=[],
    )
    assert request.question == "什么是混合检索？"

    with pytest.raises(ValidationError):
        RunRequest.model_validate({**request.model_dump(mode="json"), "unexpected": True})

    with pytest.raises(ValidationError):
        RunRequest.model_validate({**request.model_dump(mode="json"), "question": "   "})

    with pytest.raises(ValidationError):
        RunRequest.model_validate({**request.model_dump(mode="json"), "question": 123})
