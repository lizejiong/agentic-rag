from datetime import datetime
from typing import Annotated, Literal, TypeAlias
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
    title: str = Field(min_length=1)
    snippet: str
    location: CitationLocation


class RunCompleted(EventBase):
    type: Literal["run.completed"]
    finishReason: Literal["stop", "cancelled"]


class RunFailed(EventBase):
    type: Literal["run.failed"]
    code: str = Field(min_length=1)
    message: str = Field(min_length=1)
    retryable: bool


AgentEvent: TypeAlias = Annotated[
    RunStarted | RunStatus | TextDelta | Citation | RunCompleted | RunFailed,
    Field(discriminator="type"),
]


class RunRequest(StrictModel):
    requestId: UUID
    traceId: str = Field(min_length=1)
    actorId: str = Field(min_length=1)
    question: str = Field(min_length=1, max_length=8000)
    selectedSpaceIds: list[UUID] = Field(max_length=20)

    @field_validator("question", mode="before")
    @classmethod
    def strip_question(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value
