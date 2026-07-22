from __future__ import annotations

from pathlib import Path
import zipfile

import pytest

from rag_ai.ingestion.chunking.structure_chunker import StructureChunker
from rag_ai.ingestion.models import IngestionFailure
from rag_ai.ingestion.normalization.models import (
    ElementType,
    NormalizedDocument,
    NormalizedElement,
)
from rag_ai.ingestion.parsers.csv_parser import CsvParser
from rag_ai.ingestion.parsers.json_parser import JsonParser
from rag_ai.ingestion.parsers.text_parser import TextParser
from rag_ai.ingestion.security.file_validation import FileValidator


def validator() -> FileValidator:
    return FileValidator(
        max_archive_entries=100,
        max_expanded_bytes=10 * 1024 * 1024,
        max_compression_ratio=100,
    )


def test_rejects_office_archive_path_traversal(tmp_path: Path) -> None:
    document = tmp_path / "unsafe.docx"
    with zipfile.ZipFile(document, "w") as archive:
        archive.writestr("[Content_Types].xml", "types")
        archive.writestr("word/document.xml", "document")
        archive.writestr("../outside.txt", "unsafe")

    with pytest.raises(IngestionFailure, match="unsafe path") as error:
        validator().validate(document, "unsafe.docx")

    assert error.value.code == "ARCHIVE_PATH_TRAVERSAL"


def test_rejects_binary_content_disguised_as_text(tmp_path: Path) -> None:
    document = tmp_path / "note.txt"
    document.write_bytes(b"hello\x00world")

    with pytest.raises(IngestionFailure) as error:
        validator().validate(document, "note.txt")

    assert error.value.code == "FILE_SIGNATURE_MISMATCH"


def test_text_json_and_csv_preserve_useful_structure(tmp_path: Path) -> None:
    text = tmp_path / "notes.txt"
    text.write_text("第一段\n\nSecond paragraph", encoding="utf-8")
    parsed_text = TextParser().parse(
        text,
        original_file_name="notes.txt",
        extension="txt",
        detected_mime_type="text/plain",
    )
    assert [element.text for element in parsed_text.elements] == ["第一段", "Second paragraph"]

    json_file = tmp_path / "data.json"
    json_file.write_text('{"user":{"name":"Atlas"},"active":true}', encoding="utf-8")
    parsed_json = JsonParser().parse(
        json_file,
        original_file_name="data.json",
        extension="json",
        detected_mime_type="application/json",
    )
    assert {element.metadata["jsonPointer"] for element in parsed_json.elements} == {
        "/user/name",
        "/active",
    }

    csv_file = tmp_path / "people.csv"
    csv_file.write_text("name,city\nAtlas,Shanghai\n", encoding="utf-8")
    parsed_csv = CsvParser(rows_per_element=1).parse(
        csv_file,
        original_file_name="people.csv",
        extension="csv",
        detected_mime_type="text/csv",
    )
    assert [element.location.cell_range for element in parsed_csv.elements] == ["A1:B1", "A2:B2"]


def test_structure_chunker_links_context_and_respects_maximum() -> None:
    heading = NormalizedElement(index=0, type=ElementType.HEADING, text="Overview")
    paragraph = NormalizedElement(index=1, type=ElementType.PARAGRAPH, text="a" * 25)
    document = NormalizedDocument(
        title="sample",
        detected_mime_type="text/plain",
        parser_version="test/1",
        elements=[heading, paragraph],
    )

    chunks = StructureChunker(target_characters=10, max_characters=10).chunk(document)

    assert [len(chunk.text) for chunk in chunks] == [8, 10, 10, 5]
    assert all(chunk.parent_chunk_id == chunks[0].id for chunk in chunks[1:])
    assert chunks[0].next_chunk_id == chunks[1].id
    assert chunks[-1].previous_chunk_id == chunks[-2].id
    assert chunks[-1].next_chunk_id is None
