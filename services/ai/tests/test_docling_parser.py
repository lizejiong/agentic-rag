from __future__ import annotations

from pathlib import Path

from rag_ai.ingestion.parsers.docling_parser import DoclingParser


def test_parses_markdown_with_docling_simple_pipeline(tmp_path: Path) -> None:
    source = tmp_path / "source.md"
    source.write_text("# Atlas RAG\n\nA searchable knowledge base.", encoding="utf-8")

    document = DoclingParser(timeout_seconds=60).parse(
        source,
        original_file_name="captured-page.md",
        extension="md",
        detected_mime_type="text/markdown",
    )

    assert any("searchable knowledge base" in element.text for element in document.elements)
