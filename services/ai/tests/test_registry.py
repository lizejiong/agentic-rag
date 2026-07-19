from uuid import UUID

from rag_ai.runtime.registry import RunRegistry


def test_cancel_is_idempotent_for_an_active_run() -> None:
    registry = RunRegistry()
    request_id = UUID("00000000-0000-4000-8000-000000000020")
    cancelled = registry.event_for(request_id)

    registry.cancel(request_id)
    registry.cancel(request_id)

    assert cancelled.is_set()


def test_cancelling_an_unknown_run_does_not_create_state() -> None:
    registry = RunRegistry()
    request_id = UUID("00000000-0000-4000-8000-000000000021")

    registry.cancel(request_id)

    assert not registry.event_for(request_id).is_set()
