"""Pre-flight check: parse a generated fixture with the real DoclingParser.

    uv run --project services/ai python scripts/smoke-parse-check.py <fixture>
"""

from __future__ import annotations

import sys
from pathlib import Path

from rag_ai.ingestion.parsers.docling_parser import DoclingParser


def main() -> None:
    fixture = Path(sys.argv[1])
    extension = fixture.suffix.lstrip(".").lower()
    document = DoclingParser(timeout_seconds=240).parse(
        fixture,
        original_file_name=fixture.name,
        extension=extension,
        detected_mime_type="application/octet-stream",
    )
    print(f"elements: {len(document.elements)}")
    for element in document.elements:
        location = element.location
        where = location.page or location.sheet or location.slide
        print(f"[{element.type.value}] @{where} {element.text[:70]}")


if __name__ == "__main__":
    main()
