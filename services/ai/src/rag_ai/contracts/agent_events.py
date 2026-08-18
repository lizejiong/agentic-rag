from datetime import datetime
from typing import Annotated, Any, Literal, TypeAlias
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class EventBase(StrictModel):
    requestId: UUID
    traceId: str = Field(min_length=1)
    seq: int = Field(ge=0)
    occurredAt: datetime


class RunStarted(EventBase):
    type: Literal["run.started"]


class RunStatus(EventBase):
    type: Literal["run.status"]
    status: Literal["understanding", "retrieving", "ranking", "answering"]


class TextDelta(EventBase):
    type: Literal["text.delta"]
    text: str = Field(min_length=1)


class CitationLocation(StrictModel):
    page: int | None = Field(default=None, ge=1)
    slide: int | None = Field(default=None, ge=1)
    sheet: str | None = Field(default=None, min_length=1)
    cellRange: str | None = Field(default=None, min_length=1)

    @model_validator(mode="before")
    @classmethod
    def reject_explicit_nulls(cls, value: object) -> object:
        location_fields = ("page", "slide", "sheet", "cellRange")
        if isinstance(value, dict) and any(
            field in value and value[field] is None for field in location_fields
        ):
            raise ValueError("citation location fields cannot be null")
        return value


class Citation(EventBase):
    type: Literal["citation"]
    citationId: UUID
    chunkId: UUID
    documentId: UUID
    title: str = Field(min_length=1)
    snippet: str
    location: CitationLocation


class RetrievalPathSummary(StrictModel):
    path: Literal["vector", "lexical"]
    spaceId: str = Field(min_length=1)
    candidatesReturned: int = Field(ge=0)
    candidatesAfterAcl: int | None = Field(default=None, ge=0)
    error: str | None = Field(default=None)


class RetrievalSummary(EventBase):
    type: Literal["retrieval.summary"]
    summary: dict[str, Any]


class RunCompleted(EventBase):
    type: Literal["run.completed"]
    finishReason: Literal["stop", "cancelled"]


class RunFailed(EventBase):
    type: Literal["run.failed"]
    code: str = Field(min_length=1)
    message: str = Field(min_length=1)
    retryable: bool


AgentEvent: TypeAlias = Annotated[
    RunStarted
    | RunStatus
    | TextDelta
    | Citation
    | RetrievalSummary
    | RunCompleted
    | RunFailed,
    Field(discriminator="type"),
]


class RunRequest(StrictModel):
    requestId: UUID
    traceId: str = Field(min_length=1)
    actorId: str = Field(min_length=1)
    question: str = Field(min_length=1, max_length=8000)
    selectedSpaceIds: list[UUID] = Field(max_length=100)
    aclSnapshot: dict[str, Any] = Field(default_factory=dict)
    sessionId: str | None = Field(default=None, max_length=120)

    @field_validator("question", mode="before")
    @classmethod
    def strip_question(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value

    @field_validator("aclSnapshot", mode="before")
    @classmethod
    def default_acl_snapshot(cls, value: object) -> object:
        return value if isinstance(value, dict) else {}


class ChatHistoryMessage(StrictModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1)


class ChatRequest(RunRequest):
    history: list[ChatHistoryMessage] = Field(default_factory=list)
    historySummary: str = Field(default="", max_length=4000)
