from __future__ import annotations

import csv
from importlib.metadata import version
from pathlib import Path

from charset_normalizer import from_bytes

from rag_ai.ingestion.models import IngestionFailure
from rag_ai.ingestion.normalization.models import (
    ElementType,
    NormalizedDocument,
    NormalizedElement,
    SourceLocation,
)


class CsvParser:
    def __init__(self, *, rows_per_element: int = 50, max_rows: int = 1_000_000) -> None:
        self._rows_per_element = rows_per_element
        self._max_rows = max_rows

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
        batch: list[list[str]] = []
        start_row = 1
        max_columns = 0

        def flush() -> None:
            nonlocal start_row, max_columns
            if not batch:
                return
            max_columns = max(max_columns, max(len(row) for row in batch))
            end_row = start_row + len(batch) - 1
            end_column = self._column_name(max(len(row) for row in batch))
            text = "\n".join(" | ".join(cell.strip() for cell in row) for row in batch)
            elements.append(
                NormalizedElement(
                    index=len(elements),
                    type=ElementType.SHEET_REGION,
                    text=text,
                    location=SourceLocation(
                        sheet=Path(original_file_name).stem,
                        cell_range=f"A{start_row}:{end_column}{end_row}",
                    ),
                )
            )
            start_row = end_row + 1
            batch.clear()

        try:
            with path.open("r", encoding=encoding, errors="strict", newline="") as source:
                reader = csv.reader(source)
                for row_number, row in enumerate(reader, start=1):
                    if row_number > self._max_rows:
                        raise IngestionFailure(
                            "CSV_ROW_LIMIT_EXCEEDED",
                            "The CSV document exceeds the processing row limit.",
                            retryable=False,
                        )
                    batch.append(row)
                    if len(batch) >= self._rows_per_element:
                        flush()
                flush()
        except (UnicodeError, csv.Error) as error:
            raise IngestionFailure(
                "CSV_INVALID",
                "The CSV document could not be decoded or parsed.",
                retryable=False,
            ) from error

        return NormalizedDocument(
            title=Path(original_file_name).stem,
            detected_mime_type=detected_mime_type,
            parser_version=f"python-csv+charset-normalizer/{version('charset-normalizer')}",
            elements=elements,
            metadata={"encoding": encoding, "maxColumns": max_columns},
        )

    def _detect_encoding(self, path: Path) -> str:
        with path.open("rb") as source:
            sample = source.read(1024 * 1024)
        try:
            sample.decode("utf-8-sig")
            return "utf-8-sig"
        except UnicodeDecodeError:
            match = from_bytes(sample).best()
            if match is None or match.encoding is None:
                raise IngestionFailure(
                    "TEXT_ENCODING_UNKNOWN",
                    "The CSV encoding could not be identified.",
                    retryable=False,
                )
            return match.encoding

    def _column_name(self, number: int) -> str:
        value = max(number, 1)
        result = ""
        while value:
            value, remainder = divmod(value - 1, 26)
            result = chr(65 + remainder) + result
        return result
