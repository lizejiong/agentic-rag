from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Awaitable, Callable
from typing import Protocol

from pydantic import ValidationError

from rag_ai.infrastructure.redis.stream_worker import RedisStreamTransport, StreamMessage
from rag_ai.ingestion.models import (
    IngestionCommand,
    IngestionFailure,
    IngestionResult,
    OutboxEnvelope,
    ProcessingStage,
)
from rag_ai.ingestion.repository import IngestionRepository

logger = logging.getLogger(__name__)


class IngestionProcessor(Protocol):
    async def process(
        self,
        command: IngestionCommand,
        report: Callable[[ProcessingStage, int], Awaitable[None]],
    ) -> IngestionResult: ...


class DurableIngestionWorker:
    def __init__(
        self,
        transport: RedisStreamTransport,
        repository: IngestionRepository,
        processor: IngestionProcessor,
        *,
        dead_letter_stream: str,
        batch_size: int,
        block_milliseconds: int,
    ) -> None:
        self._transport = transport
        self._repository = repository
        self._processor = processor
        self._dead_letter_stream = dead_letter_stream
        self._batch_size = batch_size
        self._block_milliseconds = block_milliseconds

    async def initialize(self) -> None:
        await self._transport.ensure_group()

    async def run_once(self) -> int:
        messages = await self._transport.claim_stale(
            count=self._batch_size,
            min_idle_milliseconds=60_000,
        )
        if not messages:
            messages = await self._transport.read(
                count=self._batch_size,
                block_milliseconds=self._block_milliseconds,
            )
        for message in messages:
            await self._handle(message)
        return len(messages)

    async def _handle(self, message: StreamMessage) -> None:
        raw_envelope = message.fields.get("envelope")
        if raw_envelope is None:
            await self._dead_letter(message, "EVENT_ENVELOPE_MISSING")
            return
        try:
            envelope = OutboxEnvelope.model_validate_json(raw_envelope)
        except (ValidationError, ValueError):
            await self._dead_letter(message, "EVENT_ENVELOPE_INVALID")
            return
        if envelope.type != "document.ingestion.requested.v1":
            await self._transport.acknowledge(message.message_id)
            return
        try:
            command = IngestionCommand.from_envelope(envelope)
        except (ValidationError, ValueError):
            await self._dead_letter(message, "INGESTION_PAYLOAD_INVALID")
            return

        should_process = await self._repository.begin(command)
        if not should_process:
            await self._transport.acknowledge(message.message_id)
            return

        stage = ProcessingStage.SECURITY_CHECK
        try:
            await self._repository.progress(command, stage, 10)
            result = await self._processor.process(
                command,
                lambda next_stage, progress: self._repository.progress(
                    command, next_stage, progress
                ),
            )
            await self._repository.succeed(command, result)
        except IngestionFailure as ingestion_failure:
            await self._repository.fail(command, ingestion_failure, stage)
        except Exception:
            logger.exception(
                "Unexpected ingestion failure", extra={"event_id": str(envelope.event_id)}
            )
            internal_failure = IngestionFailure(
                "INGESTION_INTERNAL_ERROR",
                "The document could not be processed because of an internal worker error.",
                retryable=True,
            )
            await self._repository.fail(command, internal_failure, stage)
        await self._transport.acknowledge(message.message_id)

    async def _dead_letter(self, message: StreamMessage, error_code: str) -> None:
        await self._transport.publish(
            self._dead_letter_stream,
            json.dumps(
                {
                    "errorCode": error_code,
                    "streamMessageId": message.message_id,
                    "fields": message.fields,
                },
                ensure_ascii=False,
            ),
        )
        await self._transport.acknowledge(message.message_id)


class WorkerOutboxPublisher:
    def __init__(
        self,
        transport: RedisStreamTransport,
        repository: IngestionRepository,
        event_stream: str,
    ) -> None:
        self._transport = transport
        self._repository = repository
        self._event_stream = event_stream

    async def publish_once(self) -> int:
        events = await self._repository.pending_outbox()
        for pending in events:
            try:
                await self._transport.publish(self._event_stream, pending.event.redis_envelope())
                await self._repository.mark_outbox_published(pending.row_id)
            except Exception as error:
                code = type(error).__name__[:120]
                await self._repository.mark_outbox_retry(
                    pending.row_id,
                    pending.attempt + 1,
                    code,
                )
        return len(events)


class WorkerRuntime:
    def __init__(
        self,
        worker: DurableIngestionWorker,
        publisher: WorkerOutboxPublisher,
        *,
        idle_seconds: float,
    ) -> None:
        self._worker = worker
        self._publisher = publisher
        self._idle_seconds = idle_seconds

    async def run_forever(self) -> None:
        await self._worker.initialize()
        while True:
            try:
                await self._worker.run_once()
                await self._publisher.publish_once()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Worker loop failed; durable state will be retried")
                await asyncio.sleep(self._idle_seconds)
