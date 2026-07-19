from uuid import UUID

import pytest

from rag_ai.runtime.registry import RunAlreadyActiveError, RunRegistry


def test_cancel_is_idempotent_for_an_active_run() -> None:
    registry = RunRegistry()
    request_id = UUID("00000000-0000-4000-8000-000000000020")
    cancelled = registry.acquire(request_id)

    registry.cancel(request_id)
    registry.cancel(request_id)

    assert cancelled.is_set()


def test_cancelling_an_unknown_run_does_not_create_state() -> None:
    registry = RunRegistry()
    request_id = UUID("00000000-0000-4000-8000-000000000021")

    registry.cancel(request_id)

    replacement = registry.acquire(request_id)
    assert not replacement.is_set()


def test_duplicate_acquire_is_rejected() -> None:
    registry = RunRegistry()
    request_id = UUID("00000000-0000-4000-8000-000000000022")
    registry.acquire(request_id)

    with pytest.raises(RunAlreadyActiveError, match="REQUEST_ALREADY_RUNNING"):
        registry.acquire(request_id)


def test_stale_release_does_not_remove_replacement_run() -> None:
    registry = RunRegistry()
    request_id = UUID("00000000-0000-4000-8000-000000000023")
    stale = registry.acquire(request_id)
    registry.release(request_id, stale)
    replacement = registry.acquire(request_id)

    registry.release(request_id, stale)
    registry.cancel(request_id)

    assert replacement.is_set()
