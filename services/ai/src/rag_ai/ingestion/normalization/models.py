from __future__ import annotations

from enum import StrEnum
from typing import Any
from uuid import UUID, uuid4

from pydantic import BaseModel, Field


class ElementType(StrEnum):
    TITLE = "title"
    HEADING = "heading"
    PARAGRAPH = "paragraph"
    LIST_ITEM = "list_item"
    TABLE = "table"
    IMAGE_CAPTION = "image_caption"
    SHEET_REGION = "sheet_region"
    SLIDE_NOTE = "slide_note"
    CODE = "code"


class SourceLocation(BaseModel):
    page: int | None = Field(default=None, ge=1)
    slide: int | None = Field(default=None, ge=1)
    sheet: str | None = None
    cell_range: str | None = None
    bbox: tuple[float, float, float, float] | None = None


class NormalizedElement(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    index: int = Field(ge=0)
    type: ElementType
    text: str
    heading_level: int | None = Field(default=None, ge=1, le=12)
    location: SourceLocation = Field(default_factory=SourceLocation)
    metadata: dict[str, Any] = Field(default_factory=dict)


class NormalizedDocument(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    title: str
    detected_mime_type: str
    parser_version: str
    elements: list[NormalizedElement]
    metadata: dict[str, Any] = Field(default_factory=dict)


class DocumentChunk(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    index: int = Field(ge=0)
    text: str
    content_hash: str = Field(pattern=r"^[a-f0-9]{64}$")
    token_count: int = Field(ge=1)
    parent_chunk_id: UUID | None = None
    previous_chunk_id: UUID | None = None
    next_chunk_id: UUID | None = None
    location: SourceLocation = Field(default_factory=SourceLocation)
    element_ids: list[UUID] = Field(default_factory=list)
