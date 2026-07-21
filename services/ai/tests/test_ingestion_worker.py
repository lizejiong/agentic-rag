from __future__ import annotations

from datetime import UTC, datetime
from typing import cast
from uuid import UUID, uuid4

import pytest

from rag_ai.infrastructure.redis.stream_worker import RedisStreamTransport, StreamMessage
from rag_ai.ingestion.models import (
    IngestionCommand,
    IngestionDeferred,
    IngestionFailure,
    IngestionResult,
    ProcessingStage,
    WorkerEvent,
)
from rag_ai.ingestion.repository import IngestionRepository, PendingOutboxEvent
from rag_ai.ingestion.worker import (
    DurableIngestionWorker,
    IngestionProcessor,
    WorkerOutboxPublisher,
)


def requested_message() -> StreamMessage:
    event_id = uuid4()
    import_id = uuid4()
    version_id = uuid4()
    return StreamMessage(
        message_id="1-0",
        fields={
            "envelope": (
                "{"
                f'"eventId":"{event_id}",'
                '"type":"document.ingestion.requested.v1",'
                f'"taskId":"{import_id}",'
                f'"resourceId":"{version_id}",'
                '"resourceVersion":1,"attempt":0,"traceId":"trace-1",'
                f'"occurredAt":"{datetime.now(UTC).isoformat()}",'
                '"payload":{'
                f'"documentId":"{uuid4()}","spaceId":"{uuid4()}",'
                f'"versionId":"{version_id}","importId":"{import_id}",'
                '"objectKey":"imports/task-1",'
                f'"contentHash":"{"a" * 64}","sizeBytes":5,'
                '"declaredMimeType":"text/plain","originalFileName":"note.txt",'
                f'"actorId":"{uuid4()}"'
                "}}"
            )
        },
    )


class FakeTransport:
    def __init__(self, messages: list[StreamMessage]) -> None:
        self.messages = messages
        self.acknowledged: list[str] = []
        self.published: list[tuple[str, str]] = []
        self.initialized = False

    async def ensure_group(self) -> None:
        self.initialized = True

    async def claim_stale(self, *, count: int, min_idle_milliseconds: int) -> list[StreamMessage]:
        del count, min_idle_milliseconds
        return []

    async def read(self, *, count: int, block_milliseconds: int) -> list[StreamMessage]:
        del count, block_milliseconds
        messages, self.messages = self.messages, []
        return messages

    async def acknowledge(self, message_id: str) -> None:
        self.acknowledged.append(message_id)

    async def publish(self, stream: str, envelope: str) -> str:
        self.published.append((stream, envelope))
        return "2-0"


class FakeRepository:
    def __init__(self, *, should_process: bool = True) -> None:
        self.should_process = should_process
        self.begun: list[IngestionCommand] = []
        self.progressed: list[tuple[ProcessingStage, int]] = []
        self.succeeded: list[IngestionResult] = []
        self.failed: list[IngestionFailure] = []
        self.pending: list[PendingOutboxEvent] = []
        self.published: list[UUID] = []
        self.retried: list[UUID] = []

    async def begin(self, command: IngestionCommand) -> bool:
        self.begun.append(command)
        return self.should_process

    async def progress(
        self, command: IngestionCommand, stage: ProcessingStage, progress: int
    ) -> None:
        del command
        self.progressed.append((stage, progress))

    async def succeed(self, command: IngestionCommand, result: IngestionResult) -> None:
        del command
        self.succeeded.append(result)

    async def fail(
        self, command: IngestionCommand, failure: IngestionFailure, stage: ProcessingStage
    ) -> None:
        del command, stage
        self.failed.append(failure)

    async def pending_outbox(self, limit: int = 100) -> list[PendingOutboxEvent]:
        del limit
        return self.pending

    async def mark_outbox_published(self, row_id: UUID) -> None:
        self.published.append(row_id)

    async def mark_outbox_retry(self, row_id: UUID, attempt: int, error_code: str) -> None:
        del attempt, error_code
        self.retried.append(row_id)


class SuccessfulProcessor:
    async def process(self, command: IngestionCommand) -> IngestionResult:
        del command
        return IngestionResult(
            normalized_document_id=uuid4(),
            chunk_count=3,
            detected_mime_type="text/plain",
            parser_version="test-parser/1",
        )


class FailingProcessor:
    async def process(self, command: IngestionCommand) -> IngestionResult:
        del command
        raise IngestionFailure("VIRUS_FOUND", "Malware was detected.", retryable=False)


class DeferredProcessor:
    async def process(self, command: IngestionCommand) -> IngestionResult:
        del command
        raise IngestionDeferred("Parser is not installed yet.")


def build_worker(
    transport: FakeTransport,
    repository: FakeRepository,
    processor: IngestionProcessor,
) -> DurableIngestionWorker:
    return DurableIngestionWorker(
        cast(RedisStreamTransport, transport),
        cast(IngestionRepository, repository),
        processor,
        dead_letter_stream="atlas:events:dead-letter",
        batch_size=10,
        block_milliseconds=100,
    )


@pytest.mark.asyncio
async def test_commits_success_before_acknowledging() -> None:
    transport = FakeTransport([requested_message()])
    repository = FakeRepository()
    worker = build_worker(transport, repository, SuccessfulProcessor())

    assert await worker.run_once() == 1
    assert repository.progressed == [(ProcessingStage.SECURITY_CHECK, 10)]
    assert len(repository.succeeded) == 1
    assert transport.acknowledged == ["1-0"]


@pytest.mark.asyncio
async def test_persists_safe_failure_before_acknowledging() -> None:
    transport = FakeTransport([requested_message()])
    repository = FakeRepository()
    worker = build_worker(transport, repository, FailingProcessor())

    await worker.run_once()
    assert [failure.code for failure in repository.failed] == ["VIRUS_FOUND"]
    assert transport.acknowledged == ["1-0"]


@pytest.mark.asyncio
async def test_acknowledges_an_already_processed_event_without_processing_again() -> None:
    transport = FakeTransport([requested_message()])
    repository = FakeRepository(should_process=False)
    processor = SuccessfulProcessor()
    worker = build_worker(transport, repository, processor)

    await worker.run_once()
    assert repository.succeeded == []
    assert transport.acknowledged == ["1-0"]


@pytest.mark.asyncio
async def test_invalid_event_moves_to_dead_letter_before_acknowledging() -> None:
    transport = FakeTransport([StreamMessage(message_id="bad-1", fields={"envelope": "{"})])
    repository = FakeRepository()
    worker = build_worker(transport, repository, SuccessfulProcessor())

    await worker.run_once()
    assert transport.published[0][0] == "atlas:events:dead-letter"
    assert transport.acknowledged == ["bad-1"]


@pytest.mark.asyncio
async def test_deferred_processing_leaves_the_message_pending() -> None:
    transport = FakeTransport([requested_message()])
    repository = FakeRepository()
    worker = build_worker(transport, repository, DeferredProcessor())

    await worker.run_once()
    assert repository.succeeded == []
    assert repository.failed == []
    assert transport.acknowledged == []


@pytest.mark.asyncio
async def test_worker_outbox_publishes_before_marking_the_row() -> None:
    transport = FakeTransport([])
    repository = FakeRepository()
    row_id = uuid4()
    event = WorkerEvent.model_validate(
        {
            "eventId": uuid4(),
            "type": "document.ingestion.progressed.v1",
            "taskId": uuid4(),
            "resourceId": uuid4(),
            "resourceVersion": 1,
            "attempt": 0,
            "traceId": "trace-1",
            "occurredAt": datetime.now(UTC),
            "payload": {
                "documentId": str(uuid4()),
                "spaceId": str(uuid4()),
                "versionId": str(uuid4()),
                "importId": str(uuid4()),
                "stage": "SECURITY_CHECK",
                "progress": 10,
            },
        }
    )
    repository.pending = [PendingOutboxEvent(row_id=row_id, event=event, attempt=0)]
    publisher = WorkerOutboxPublisher(
        cast(RedisStreamTransport, transport),
        cast(IngestionRepository, repository),
        "atlas:events",
    )

    assert await publisher.publish_once() == 1
    assert transport.published[0][0] == "atlas:events"
    assert repository.published == [row_id]
