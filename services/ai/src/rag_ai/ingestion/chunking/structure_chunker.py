from __future__ import annotations

from hashlib import sha256
import re
from uuid import UUID

from rag_ai.ingestion.normalization.models import (
    DocumentChunk,
    ElementType,
    NormalizedDocument,
    NormalizedElement,
)

_CJK_PATTERN = re.compile(r"[\u3400-\u9fff\uf900-\ufaff]")


class StructureChunker:
    def __init__(self, *, target_characters: int, max_characters: int) -> None:
        if target_characters > max_characters:
            raise ValueError("target_characters must not exceed max_characters")
        self._target = target_characters
        self._maximum = max_characters

    def chunk(self, document: NormalizedDocument) -> list[DocumentChunk]:
        chunks: list[DocumentChunk] = []
        buffer: list[NormalizedElement] = []
        parent_heading_id: UUID | None = None

        def flush() -> None:
            nonlocal buffer
            if not buffer:
                return
            text = "\n\n".join(element.text for element in buffer).strip()
            for part in self._split_text(text):
                chunks.append(
                    self._create_chunk(
                        len(chunks),
                        part,
                        buffer,
                        parent_heading_id,
                    )
                )
            buffer = []

        for element in document.elements:
            if element.type in {ElementType.TITLE, ElementType.HEADING}:
                flush()
                heading = self._create_chunk(len(chunks), element.text, [element], None)
                chunks.append(heading)
                parent_heading_id = heading.id
                continue
            if element.type in {ElementType.TABLE, ElementType.SHEET_REGION, ElementType.CODE}:
                flush()
                for part in self._split_text(element.text):
                    chunks.append(
                        self._create_chunk(
                            len(chunks),
                            part,
                            [element],
                            parent_heading_id,
                        )
                    )
                continue
            candidate_length = sum(len(item.text) for item in buffer) + len(element.text)
            if buffer and candidate_length > self._target:
                flush()
            buffer.append(element)
        flush()

        for index, chunk in enumerate(chunks):
            chunk.previous_chunk_id = chunks[index - 1].id if index > 0 else None
            chunk.next_chunk_id = chunks[index + 1].id if index + 1 < len(chunks) else None
        return chunks

    def _create_chunk(
        self,
        index: int,
        text: str,
        elements: list[NormalizedElement],
        parent_chunk_id: UUID | None,
    ) -> DocumentChunk:
        return DocumentChunk(
            index=index,
            text=text,
            content_hash=sha256(text.encode("utf-8")).hexdigest(),
            token_count=self._estimate_tokens(text),
            parent_chunk_id=parent_chunk_id,
            location=elements[0].location,
            element_ids=[element.id for element in elements],
        )

    def _split_text(self, text: str) -> list[str]:
        if len(text) <= self._maximum:
            return [text]
        parts: list[str] = []
        remaining = text
        while len(remaining) > self._maximum:
            boundary = remaining.rfind("\n", 0, self._maximum)
            if boundary < self._maximum // 2:
                boundary = remaining.rfind("。", 0, self._maximum)
            if boundary < self._maximum // 2:
                boundary = remaining.rfind(". ", 0, self._maximum)
                if boundary >= 0:
                    boundary += 1
            if boundary < self._maximum // 2:
                boundary = self._maximum
            part = remaining[:boundary].strip()
            if part:
                parts.append(part)
            remaining = remaining[boundary:].strip()
        if remaining:
            parts.append(remaining)
        return parts

    def _estimate_tokens(self, text: str) -> int:
        cjk_count = len(_CJK_PATTERN.findall(text))
        other_count = max(len(text) - cjk_count, 0)
        return max(1, cjk_count + (other_count + 3) // 4)
