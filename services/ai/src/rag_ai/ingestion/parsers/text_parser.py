from __future__ import annotations

from importlib.metadata import version
from pathlib import Path

from charset_normalizer import from_bytes

from rag_ai.ingestion.models import IngestionFailure
from rag_ai.ingestion.normalization.models import (
    ElementType,
    NormalizedDocument,
    NormalizedElement,
)


class TextParser:
    def __init__(self, *, max_characters: int = 50_000_000) -> None:
        self._max_characters = max_characters

    def parse(
        self,
        path: Path,
        *,
        original_file_name: str,
        extension: str,
        detected_mime_type: str,
    ) -> NormalizedDocument:
        del extension
        encoding = self._detect_encoding(path)
        elements: list[NormalizedElement] = []
        paragraph: list[str] = []
        character_count = 0

        def flush() -> None:
            text = "\n".join(paragraph).strip()
            paragraph.clear()
            if text:
                elements.append(
                    NormalizedElement(index=len(elements), type=ElementType.PARAGRAPH, text=text)
                )

        try:
            with path.open("r", encoding=encoding, errors="strict", newline=None) as source:
                for line in source:
                    character_count += len(line)
                    if character_count > self._max_characters:
                        raise IngestionFailure(
                            "TEXT_CHARACTER_LIMIT_EXCEEDED",
                            "The decoded text exceeds the processing character limit.",
                            retryable=False,
                        )
                    if line.strip():
                        paragraph.append(line.rstrip())
                    else:
                        flush()
                flush()
        except UnicodeError as error:
            raise IngestionFailure(
                "TEXT_ENCODING_INVALID",
                "The text encoding could not be decoded safely.",
                retryable=False,
            ) from error

        return NormalizedDocument(
            title=Path(original_file_name).stem,
            detected_mime_type=detected_mime_type,
            parser_version=f"charset-normalizer/{version('charset-normalizer')}",
            elements=elements,
            metadata={"encoding": encoding},
        )

    def _detect_encoding(self, path: Path) -> str:
        with path.open("rb") as source:
            sample = source.read(1024 * 1024)
        if sample.startswith(b"\xef\xbb\xbf"):
            return "utf-8-sig"
        try:
            sample.decode("utf-8")
            return "utf-8"
        except UnicodeDecodeError:
            match = from_bytes(sample).best()
            if match is None or match.encoding is None:
                raise IngestionFailure(
                    "TEXT_ENCODING_UNKNOWN",
                    "The text encoding could not be identified.",
                    retryable=False,
                )
            return match.encoding
