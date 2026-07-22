from __future__ import annotations

from rag_ai.ingestion.parsers.base import DocumentParser
from rag_ai.ingestion.parsers.csv_parser import CsvParser
from rag_ai.ingestion.parsers.docling_parser import DoclingParser
from rag_ai.ingestion.parsers.json_parser import JsonParser
from rag_ai.ingestion.parsers.text_parser import TextParser


class ParserRegistry:
    def __init__(self, *, docling: DoclingParser) -> None:
        self._parsers: dict[str, DocumentParser] = {
            "pdf": docling,
            "docx": docling,
            "xlsx": docling,
            "pptx": docling,
            "md": docling,
            "txt": TextParser(),
            "json": JsonParser(),
            "csv": CsvParser(),
        }

    def for_extension(self, extension: str) -> DocumentParser:
        return self._parsers[extension]
