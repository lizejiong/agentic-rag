from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from rag_ai.ingestion.models import IngestionFailure
from rag_ai.ingestion.normalization.models import (
    ElementType,
    NormalizedDocument,
    NormalizedElement,
    SourceLocation,
)


class JsonParser:
    def __init__(
        self,
        *,
        max_depth: int = 100,
        max_nodes: int = 1_000_000,
        max_string_characters: int = 1_000_000,
    ) -> None:
        self._max_depth = max_depth
        self._max_nodes = max_nodes
        self._max_string_characters = max_string_characters

    def parse(
        self,
        path: Path,
        *,
        original_file_name: str,
        extension: str,
        detected_mime_type: str,
    ) -> NormalizedDocument:
        del extension
        try:
            with path.open("r", encoding="utf-8-sig") as source:
                value = json.load(source)
        except (UnicodeError, json.JSONDecodeError) as error:
            raise IngestionFailure(
                "JSON_INVALID",
                "The JSON document is not valid UTF-8 JSON.",
                retryable=False,
            ) from error

        elements: list[NormalizedElement] = []
        node_count = 0

        def visit(node: Any, pointer: str, depth: int) -> None:
            nonlocal node_count
            node_count += 1
            if node_count > self._max_nodes or depth > self._max_depth:
                raise IngestionFailure(
                    "JSON_RESOURCE_LIMIT_EXCEEDED",
                    "The JSON document exceeds depth or node limits.",
                    retryable=False,
                )
            if isinstance(node, dict):
                for key, child in node.items():
                    escaped = str(key).replace("~", "~0").replace("/", "~1")
                    visit(child, f"{pointer}/{escaped}", depth + 1)
                return
            if isinstance(node, list):
                for index, child in enumerate(node):
                    visit(child, f"{pointer}/{index}", depth + 1)
                return
            serialized = json.dumps(node, ensure_ascii=False)
            if len(serialized) > self._max_string_characters:
                raise IngestionFailure(
                    "JSON_STRING_LIMIT_EXCEEDED",
                    "A JSON scalar exceeds the processing character limit.",
                    retryable=False,
                )
            elements.append(
                NormalizedElement(
                    index=len(elements),
                    type=ElementType.PARAGRAPH,
                    text=f"{pointer or '/'}: {serialized}",
                    location=SourceLocation(),
                    metadata={"jsonPointer": pointer or "/"},
                )
            )

        visit(value, "", 0)
        return NormalizedDocument(
            title=Path(original_file_name).stem,
            detected_mime_type=detected_mime_type,
            parser_version="python-json/1",
            elements=elements,
            metadata={"nodeCount": node_count},
        )
