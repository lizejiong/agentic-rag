from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from rag_ai.ingestion.models import (
    IngestionCommand,
    IngestionFailure,
    IngestionResult,
    ProcessingStage,
    WorkerEvent,
)

CONSUMER_NAME = "rag-ai-ingestion-v1"


@dataclass(frozen=True)
class PendingOutboxEvent:
    row_id: UUID
    event: WorkerEvent
    attempt: int


class IngestionRepository:
    def __init__(self, engine: AsyncEngine) -> None:
        self._engine = engine

    async def close(self) -> None:
        await self._engine.dispose()

    async def begin(self, command: IngestionCommand) -> bool:
        payload = command.payload
        envelope = command.envelope
        run_id = uuid4()
        async with self._engine.begin() as connection:
            inserted = await connection.execute(
                text(
                    """
                    INSERT INTO rag.ingestion_runs (
                        id, source_event_id, import_id, document_id, version_id, space_id,
                        status, stage, progress, attempt, started_at, updated_at
                    ) VALUES (
                        :id, :source_event_id, :import_id, :document_id, :version_id, :space_id,
                        'RUNNING', 'QUEUED', 5, 1, NOW(), NOW()
                    )
                    ON CONFLICT (source_event_id) DO NOTHING
                    RETURNING id
                    """
                ),
                {
                    "id": run_id,
                    "source_event_id": envelope.event_id,
                    "import_id": payload.import_id,
                    "document_id": payload.document_id,
                    "version_id": payload.version_id,
                    "space_id": payload.space_id,
                },
            )
            if inserted.scalar_one_or_none() is not None:
                return True

            existing = await connection.execute(
                text(
                    """
                    SELECT status
                    FROM rag.ingestion_runs
                    WHERE source_event_id = :source_event_id
                    FOR UPDATE
                    """
                ),
                {"source_event_id": envelope.event_id},
            )
            status = existing.scalar_one()
            if status in {"SUCCEEDED", "FAILED", "CANCELLED"}:
                return False
            await connection.execute(
                text(
                    """
                    UPDATE rag.ingestion_runs
                    SET status = 'RUNNING', attempt = attempt + 1, updated_at = NOW()
                    WHERE source_event_id = :source_event_id
                    """
                ),
                {"source_event_id": envelope.event_id},
            )
            return True

    async def progress(
        self,
        command: IngestionCommand,
        stage: ProcessingStage,
        progress: int,
    ) -> None:
        bounded_progress = max(5, min(progress, 99))
        payload = self._base_payload(command) | {
            "stage": stage.value,
            "progress": bounded_progress,
        }
        event = self._event(command, "document.ingestion.progressed.v1", payload)
        async with self._engine.begin() as connection:
            updated = await connection.execute(
                text(
                    """
                    UPDATE rag.ingestion_runs
                    SET stage = :stage, progress = :progress, updated_at = NOW()
                    WHERE source_event_id = :source_event_id
                      AND status = 'RUNNING'
                      AND progress < :progress
                    RETURNING progress
                    """
                ),
                {
                    "stage": stage.value,
                    "progress": bounded_progress,
                    "source_event_id": command.envelope.event_id,
                },
            )
            if updated.scalar_one_or_none() is not None:
                await self._insert_outbox(connection, event)

    async def succeed(self, command: IngestionCommand, result: IngestionResult) -> None:
        payload = self._base_payload(command) | {
            "normalizedDocumentId": str(result.document.id),
            "chunkCount": len(result.chunks),
            "detectedMimeType": result.document.detected_mime_type,
            "parserVersion": result.document.parser_version,
        }
        event = self._event(command, "document.ingestion.completed.v1", payload)
        async with self._engine.begin() as connection:
            await connection.execute(
                text("DELETE FROM rag.normalized_documents WHERE version_id = :version_id"),
                {"version_id": command.payload.version_id},
            )
            await connection.execute(
                text(
                    """
                    INSERT INTO rag.normalized_documents (
                        id, version_id, document_id, space_id, title, metadata
                    ) VALUES (
                        :id, :version_id, :document_id, :space_id, :title,
                        CAST(:metadata AS jsonb)
                    )
                    """
                ),
                {
                    "id": result.document.id,
                    "version_id": command.payload.version_id,
                    "document_id": command.payload.document_id,
                    "space_id": command.payload.space_id,
                    "title": result.document.title,
                    "metadata": json.dumps(result.document.metadata, ensure_ascii=False),
                },
            )
            if result.document.elements:
                await connection.execute(
                    text(
                        """
                        INSERT INTO rag.normalized_elements (
                            id, normalized_document_id, element_index, element_type,
                            content, location, metadata
                        ) VALUES (
                            :id, :normalized_document_id, :element_index, :element_type,
                            :content, CAST(:location AS jsonb), CAST(:metadata AS jsonb)
                        )
                        """
                    ),
                    [
                        {
                            "id": element.id,
                            "normalized_document_id": result.document.id,
                            "element_index": element.index,
                            "element_type": element.type.value,
                            "content": element.text,
                            "location": element.location.model_dump_json(exclude_none=True),
                            "metadata": json.dumps(element.metadata, ensure_ascii=False),
                        }
                        for element in result.document.elements
                    ],
                )
            if result.chunks:
                acl_snapshot = json.dumps(command.payload.acl_snapshot, ensure_ascii=False)
                await connection.execute(
                    text(
                        """
                        INSERT INTO rag.chunks (
                            id, normalized_document_id, document_id, version_id, space_id,
                            chunk_index, content, content_hash, token_count,
                            parent_chunk_id, previous_chunk_id, next_chunk_id,
                            location, acl_snapshot, element_ids
                        ) VALUES (
                            :id, :normalized_document_id, :document_id, :version_id, :space_id,
                            :chunk_index, :content, :content_hash, :token_count,
                            :parent_chunk_id, :previous_chunk_id, :next_chunk_id,
                            CAST(:location AS jsonb), CAST(:acl_snapshot AS jsonb),
                            CAST(:element_ids AS jsonb)
                        )
                        """
                    ),
                    [
                        {
                            "id": chunk.id,
                            "normalized_document_id": result.document.id,
                            "document_id": command.payload.document_id,
                            "version_id": command.payload.version_id,
                            "space_id": command.payload.space_id,
                            "chunk_index": chunk.index,
                            "content": chunk.text,
                            "content_hash": chunk.content_hash,
                            "token_count": chunk.token_count,
                            "parent_chunk_id": chunk.parent_chunk_id,
                            "previous_chunk_id": chunk.previous_chunk_id,
                            "next_chunk_id": chunk.next_chunk_id,
                            "location": chunk.location.model_dump_json(exclude_none=True),
                            "acl_snapshot": acl_snapshot,
                            "element_ids": json.dumps([str(value) for value in chunk.element_ids]),
                        }
                        for chunk in result.chunks
                    ],
                )
            await connection.execute(
                text(
                    """
                    UPDATE rag.ingestion_runs
                    SET status = 'SUCCEEDED', stage = 'READY', progress = 100,
                        completed_at = NOW(), updated_at = NOW(),
                        error_code = NULL, error_message = NULL
                    WHERE source_event_id = :source_event_id
                    """
                ),
                {"source_event_id": command.envelope.event_id},
            )
            await self._insert_processed(connection, command.envelope.event_id)
            await self._insert_outbox(connection, event)

    async def fail(
        self,
        command: IngestionCommand,
        failure: IngestionFailure,
        stage: ProcessingStage,
    ) -> None:
        payload = self._base_payload(command) | {
            "stage": stage.value,
            "code": failure.code,
            "message": failure.safe_message,
            "retryable": failure.retryable,
        }
        event = self._event(command, "document.ingestion.failed.v1", payload)
        async with self._engine.begin() as connection:
            await connection.execute(
                text(
                    """
                    UPDATE rag.ingestion_runs
                    SET status = 'FAILED', stage = :stage, error_code = :error_code,
                        error_message = :error_message, completed_at = NOW(), updated_at = NOW()
                    WHERE source_event_id = :source_event_id
                    """
                ),
                {
                    "stage": stage.value,
                    "error_code": failure.code,
                    "error_message": failure.safe_message,
                    "source_event_id": command.envelope.event_id,
                },
            )
            await self._insert_processed(connection, command.envelope.event_id)
            await self._insert_outbox(connection, event)

    async def pending_outbox(self, limit: int = 100) -> list[PendingOutboxEvent]:
        async with self._engine.connect() as connection:
            result = await connection.execute(
                text(
                    """
                    SELECT id, event_id, event_type, task_id, resource_id, resource_version,
                           trace_id, payload, attempt, created_at
                    FROM rag.worker_outbox
                    WHERE status = 'PENDING' AND next_attempt_at <= NOW()
                    ORDER BY created_at ASC
                    LIMIT :limit
                    """
                ),
                {"limit": limit},
            )
            rows = result.mappings().all()
        return [
            PendingOutboxEvent(
                row_id=row["id"],
                attempt=row["attempt"],
                event=WorkerEvent.model_validate(
                    {
                        "eventId": row["event_id"],
                        "type": row["event_type"],
                        "taskId": row["task_id"],
                        "resourceId": row["resource_id"],
                        "resourceVersion": row["resource_version"],
                        "attempt": row["attempt"],
                        "traceId": row["trace_id"],
                        "occurredAt": row["created_at"],
                        "payload": row["payload"],
                    }
                ),
            )
            for row in rows
        ]

    async def mark_outbox_published(self, row_id: UUID) -> None:
        async with self._engine.begin() as connection:
            await connection.execute(
                text(
                    """
                    UPDATE rag.worker_outbox
                    SET status = 'PUBLISHED', published_at = NOW(), updated_at = NOW(),
                        error_code = NULL
                    WHERE id = :id
                    """
                ),
                {"id": row_id},
            )

    async def mark_outbox_retry(self, row_id: UUID, attempt: int, error_code: str) -> None:
        next_attempt = datetime.now(UTC) + timedelta(seconds=min(300, 2 ** min(attempt, 8)))
        async with self._engine.begin() as connection:
            await connection.execute(
                text(
                    """
                    UPDATE rag.worker_outbox
                    SET attempt = :attempt, error_code = :error_code,
                        next_attempt_at = :next_attempt_at, updated_at = NOW()
                    WHERE id = :id
                    """
                ),
                {
                    "id": row_id,
                    "attempt": attempt,
                    "error_code": error_code[:120],
                    "next_attempt_at": next_attempt,
                },
            )

    async def _insert_processed(self, connection: Any, event_id: UUID) -> None:
        await connection.execute(
            text(
                """
                INSERT INTO rag.processed_events (event_id, consumer)
                VALUES (:event_id, :consumer)
                ON CONFLICT (event_id, consumer) DO NOTHING
                """
            ),
            {"event_id": event_id, "consumer": CONSUMER_NAME},
        )

    async def _insert_outbox(self, connection: Any, event: WorkerEvent) -> None:
        await connection.execute(
            text(
                """
                INSERT INTO rag.worker_outbox (
                    id, event_id, event_type, task_id, resource_id, resource_version,
                    trace_id, payload, status, attempt, next_attempt_at, created_at, updated_at
                ) VALUES (
                    :id, :event_id, :event_type, :task_id, :resource_id, :resource_version,
                    :trace_id, CAST(:payload AS jsonb), 'PENDING', 0, NOW(), NOW(), NOW()
                )
                ON CONFLICT (event_id) DO NOTHING
                """
            ),
            {
                "id": uuid4(),
                "event_id": event.event_id,
                "event_type": event.type,
                "task_id": event.task_id,
                "resource_id": event.resource_id,
                "resource_version": event.resource_version,
                "trace_id": event.trace_id,
                "payload": json.dumps(event.payload, ensure_ascii=False),
            },
        )

    def _event(
        self, command: IngestionCommand, event_type: str, payload: dict[str, Any]
    ) -> WorkerEvent:
        return WorkerEvent.model_validate(
            {
                "eventId": uuid4(),
                "type": event_type,
                "taskId": command.payload.import_id,
                "resourceId": command.payload.version_id,
                "resourceVersion": 1,
                "attempt": 0,
                "traceId": command.envelope.trace_id,
                "occurredAt": datetime.now(UTC),
                "payload": payload,
            }
        )

    def _base_payload(self, command: IngestionCommand) -> dict[str, Any]:
        payload = command.payload
        return {
            "documentId": str(payload.document_id),
            "spaceId": str(payload.space_id),
            "versionId": str(payload.version_id),
            "importId": str(payload.import_id),
        }


def create_ingestion_repository(database_url: str) -> IngestionRepository:
    engine = create_async_engine(database_url, pool_pre_ping=True)
    return IngestionRepository(engine)
