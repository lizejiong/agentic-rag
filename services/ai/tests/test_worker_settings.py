from pydantic import ValidationError
import pytest

from rag_ai.settings import WorkerSettings


def worker_environment() -> dict[str, str]:
    return {
        "DATABASE_URL": "postgresql://atlas:secret@localhost/atlas_rag",
        "REDIS_URL": "redis://:secret@localhost:6379",
    }


def test_worker_settings_have_safe_local_transport_defaults(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    for key, value in worker_environment().items():
        monkeypatch.setenv(key, value)

    settings = WorkerSettings(_env_file=None)

    assert settings.event_stream == "atlas:events"
    assert settings.worker_consumer_group == "rag-ai-ingestion-v1"
    assert settings.minio_quarantine_bucket == "atlas-rag-quarantine"


def test_worker_settings_reject_unbounded_batch_size(monkeypatch: pytest.MonkeyPatch) -> None:
    for key, value in worker_environment().items():
        monkeypatch.setenv(key, value)
    monkeypatch.setenv("WORKER_BATCH_SIZE", "101")

    with pytest.raises(ValidationError):
        WorkerSettings(_env_file=None)
