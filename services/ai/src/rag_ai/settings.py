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

    # Model adapters. Defaults use deterministic mocks so the system builds and
    # tests without cloud credentials or heavy local models.
    embedding_provider: str = Field(default="mock", pattern=r"^(mock|openai|local)$")
    embedding_dimensions: int = Field(default=384, ge=2, le=4_096)
    embedding_version: str = Field(default="mock-1", min_length=1, max_length=40)

    reranker_provider: str = Field(default="mock", pattern=r"^(none|mock|cohere)$")
    reranker_version: str = Field(default="mock-1", min_length=1, max_length=40)

    llm_provider: str = Field(default="mock", pattern=r"^(none|mock|openai)$")
    llm_version: str = Field(default="mock-1", min_length=1, max_length=40)
    llm_max_tokens: int = Field(default=2_048, ge=64, le=8_192)
    llm_temperature: float = Field(default=0.3, ge=0.0, le=2.0)

    # Retrieval limits. These match the PRD defaults and are versioned through
    # the retrieval policy in future work.
    retrieval_vector_top_k: int = Field(default=50, ge=1, le=500)
    retrieval_lexical_top_k: int = Field(default=50, ge=1, le=500)
    retrieval_rrf_top_k: int = Field(default=30, ge=1, le=500)
    retrieval_rrf_k: int = Field(default=60, ge=1, le=1_000)
    retrieval_rerank_top_k: int = Field(default=10, ge=1, le=100)

    # Elasticsearch connection. When empty, retrieval falls back to pgvector only.
    elasticsearch_url: str = Field(
        default="http://elastic:change-me-elastic@127.0.0.1:9200", min_length=1
    )
    elasticsearch_index: str = Field(default="atlas_chunks", min_length=1, max_length=120)

    # Short-term memory.
    memory_window_turns: int = Field(default=10, ge=0, le=100)
    memory_ttl_seconds: int = Field(default=86_400, ge=60, le=7_776_000)


@lru_cache
def get_worker_settings() -> WorkerSettings:
    return WorkerSettings()  # type: ignore[call-arg]  # Values come from settings sources.
