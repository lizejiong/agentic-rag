from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from rag_ai.ingestion.normalization.models import DocumentChunk, NormalizedDocument


class ProcessingStage(StrEnum):
    QUEUED = "QUEUED"
    SECURITY_CHECK = "SECURITY_CHECK"
    PARSING = "PARSING"
    NORMALIZING = "NORMALIZING"
    CHUNKING = "CHUNKING"


class OutboxEnvelope(BaseModel):
    model_config = ConfigDict(extra="forbid")

    event_id: UUID = Field(alias="eventId")
    type: str
    task_id: str | None = Field(default=None, alias="taskId")
    resource_id: str = Field(alias="resourceId", min_length=1, max_length=120)
    resource_version: int = Field(alias="resourceVersion", ge=1)
    attempt: int = Field(ge=0)
    trace_id: str = Field(alias="traceId", min_length=1, max_length=120)
    occurred_at: datetime = Field(alias="occurredAt")
    payload: dict[str, Any]


class IngestionRequestedPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    document_id: UUID = Field(alias="documentId")
    space_id: UUID = Field(alias="spaceId")
    version_id: UUID = Field(alias="versionId")
    import_id: UUID = Field(alias="importId")
    object_key: str = Field(alias="objectKey", min_length=1, max_length=1024)
    content_hash: str = Field(alias="contentHash", pattern=r"^[a-f0-9]{64}$")
    size_bytes: int = Field(alias="sizeBytes", gt=0, le=200 * 1024 * 1024)
    declared_mime_type: str = Field(alias="declaredMimeType", min_length=1, max_length=160)
    original_file_name: str = Field(alias="originalFileName", min_length=1, max_length=255)
    actor_id: UUID = Field(alias="actorId")
    acl_snapshot: dict[str, Any] = Field(default_factory=dict, alias="aclSnapshot")


class IngestionCommand(BaseModel):
    envelope: OutboxEnvelope
    payload: IngestionRequestedPayload

    @classmethod
    def from_envelope(cls, envelope: OutboxEnvelope) -> IngestionCommand:
        command = cls(
            envelope=envelope,
            payload=IngestionRequestedPayload.model_validate(envelope.payload),
        )
        if envelope.task_id != str(command.payload.import_id):
            raise ValueError("The ingestion taskId does not match payload.importId.")
        if envelope.resource_id != str(command.payload.version_id):
            raise ValueError("The ingestion resourceId does not match payload.versionId.")
        return command


class IngestionResult(BaseModel):
    document: NormalizedDocument
    chunks: list[DocumentChunk]


class WorkerEvent(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    event_id: UUID = Field(alias="eventId")
    type: Literal[
        "document.ingestion.progressed.v1",
        "document.ingestion.completed.v1",
        "document.ingestion.failed.v1",
    ]
    task_id: UUID = Field(alias="taskId")
    resource_id: UUID = Field(alias="resourceId")
    resource_version: Literal[1] = Field(default=1, alias="resourceVersion")
    attempt: int = Field(default=0, ge=0)
    trace_id: str = Field(alias="traceId")
    occurred_at: datetime = Field(alias="occurredAt")
    payload: dict[str, Any]

    def redis_envelope(self) -> str:
        return self.model_dump_json(by_alias=True)


class IngestionFailure(Exception):
    def __init__(self, code: str, message: str, *, retryable: bool) -> None:
        super().__init__(message)
        self.code = code[:120]
        self.safe_message = message[:1000]
        self.retryable = retryable
