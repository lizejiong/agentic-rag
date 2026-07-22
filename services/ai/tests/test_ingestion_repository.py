from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine

from rag_ai.ingestion.models import IngestionCommand, OutboxEnvelope
from rag_ai.ingestion.repository import IngestionRepository


def command() -> IngestionCommand:
    import_id = uuid4()
    version_id = uuid4()
    envelope = OutboxEnvelope.model_validate(
        {
            "eventId": uuid4(),
            "type": "document.ingestion.requested.v1",
            "taskId": str(import_id),
            "resourceId": str(version_id),
            "resourceVersion": 1,
            "attempt": 0,
            "traceId": "trace-1",
            "occurredAt": datetime.now(UTC),
            "payload": {
                "documentId": str(uuid4()),
                "spaceId": str(uuid4()),
                "versionId": str(version_id),
                "importId": str(import_id),
                "objectKey": f"imports/{import_id}",
                "contentHash": "a" * 64,
                "sizeBytes": 5,
                "declaredMimeType": "text/plain",
                "originalFileName": "note.txt",
                "actorId": str(uuid4()),
            },
        }
    )
    return IngestionCommand.from_envelope(envelope)


def repository_with_connection() -> tuple[IngestionRepository, AsyncMock]:
    connection = AsyncMock(spec=AsyncConnection)
    transaction = MagicMock()
    transaction.__aenter__ = AsyncMock(return_value=connection)
    transaction.__aexit__ = AsyncMock(return_value=False)
    engine = MagicMock(spec=AsyncEngine)
    engine.begin.return_value = transaction
    return IngestionRepository(engine), connection


@pytest.mark.asyncio
async def test_begin_inserts_a_durable_run() -> None:
    repository, connection = repository_with_connection()
    insert_result = MagicMock()
    insert_result.scalar_one_or_none.return_value = uuid4()
    connection.execute.return_value = insert_result

    assert await repository.begin(command()) is True
    sql = str(connection.execute.await_args_list[0].args[0])
    assert "INSERT INTO rag.ingestion_runs" in sql
    assert "ON CONFLICT (source_event_id) DO NOTHING" in sql


@pytest.mark.asyncio
async def test_terminal_duplicate_is_not_processed_again() -> None:
    repository, connection = repository_with_connection()
    insert_result = MagicMock()
    insert_result.scalar_one_or_none.return_value = None
    select_result = MagicMock()
    select_result.scalar_one.return_value = "SUCCEEDED"
    connection.execute.side_effect = [insert_result, select_result]

    assert await repository.begin(command()) is False
    assert connection.execute.await_count == 2


@pytest.mark.asyncio
async def test_outbox_retry_uses_bounded_backoff() -> None:
    repository, connection = repository_with_connection()

    await repository.mark_outbox_retry(uuid4(), 20, "RedisConnectionError")
    parameters = connection.execute.await_args.args[1]
    delay = parameters["next_attempt_at"] - datetime.now(UTC)
    assert 250 <= delay.total_seconds() <= 256
    assert parameters["error_code"] == "RedisConnectionError"
