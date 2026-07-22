from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field, RedisDsn
from pydantic_settings import SettingsConfigDict

from rag_ai.infrastructure.database.settings import DatabaseSettings, PROJECT_ROOT


class WorkerSettings(DatabaseSettings):
    model_config = SettingsConfigDict(
        env_file=(Path.cwd() / ".env", PROJECT_ROOT / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    redis_url: RedisDsn
    event_stream: str = "atlas:events"
    event_dead_letter_stream: str = "atlas:events:dead-letter"
    worker_consumer_group: str = "rag-ai-ingestion-v1"
    worker_consumer_name: str = "rag-ai-worker-1"
    worker_block_milliseconds: int = Field(default=1_000, ge=100, le=60_000)
    worker_batch_size: int = Field(default=10, ge=1, le=100)
    worker_outbox_poll_seconds: float = Field(default=1.0, ge=0.1, le=60.0)

    minio_endpoint: str = "127.0.0.1:9000"
    minio_access_key: str = "atlas"
    minio_secret_key: str = "change-me-minio"
    minio_use_ssl: bool = False
    minio_quarantine_bucket: str = "atlas-rag-quarantine"

    clamav_host: str = "127.0.0.1"
    clamav_port: int = Field(default=3310, ge=1, le=65_535)
    clamav_timeout_seconds: float = Field(default=120.0, ge=1.0, le=600.0)
    clamav_required: bool = True

    ingestion_max_archive_entries: int = Field(default=10_000, ge=1, le=100_000)
    ingestion_max_expanded_bytes: int = Field(
        default=1024 * 1024 * 1024,
        ge=1024 * 1024,
        le=4 * 1024 * 1024 * 1024,
    )
    ingestion_max_compression_ratio: float = Field(default=100.0, ge=1.0, le=1000.0)
    ingestion_parser_timeout_seconds: int = Field(default=1_800, ge=30, le=3_600)
    ingestion_chunk_target_chars: int = Field(default=2_000, ge=200, le=20_000)
    ingestion_chunk_max_chars: int = Field(default=4_000, ge=500, le=40_000)


@lru_cache
def get_worker_settings() -> WorkerSettings:
    return WorkerSettings()  # type: ignore[call-arg]  # Values come from settings sources.
