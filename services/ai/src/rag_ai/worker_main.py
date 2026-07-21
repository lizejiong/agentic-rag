from __future__ import annotations

import asyncio
import logging

from rag_ai.infrastructure.redis.stream_worker import create_redis_transport
from rag_ai.infrastructure.storage.minio_storage import create_minio_storage
from rag_ai.ingestion.repository import create_ingestion_repository
from rag_ai.ingestion.worker import (
    DurableIngestionWorker,
    PipelineUnavailableProcessor,
    WorkerOutboxPublisher,
    WorkerRuntime,
)
from rag_ai.settings import get_worker_settings


async def run_worker() -> None:
    settings = get_worker_settings()
    repository = create_ingestion_repository(settings.async_sqlalchemy_url)
    transport = create_redis_transport(
        str(settings.redis_url),
        settings.event_stream,
        settings.worker_consumer_group,
        settings.worker_consumer_name,
    )
    storage = create_minio_storage(
        settings.minio_endpoint,
        settings.minio_access_key,
        settings.minio_secret_key,
        settings.minio_use_ssl,
        settings.minio_quarantine_bucket,
    )
    worker = DurableIngestionWorker(
        transport,
        repository,
        PipelineUnavailableProcessor(storage),
        dead_letter_stream=settings.event_dead_letter_stream,
        batch_size=settings.worker_batch_size,
        block_milliseconds=settings.worker_block_milliseconds,
    )
    publisher = WorkerOutboxPublisher(transport, repository, settings.event_stream)
    runtime = WorkerRuntime(
        worker,
        publisher,
        idle_seconds=settings.worker_outbox_poll_seconds,
    )
    try:
        await runtime.run_forever()
    finally:
        await transport.close()
        await repository.close()


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    asyncio.run(run_worker())


if __name__ == "__main__":
    main()
