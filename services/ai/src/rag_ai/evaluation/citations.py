from __future__ import annotations

from collections.abc import Iterable


def citation_document_ids(events: Iterable[dict[str, object]]) -> list[str]:
    seen: set[str] = set()
    document_ids: list[str] = []
    for event in events:
        if event.get("type") != "citation":
            continue
        document_id = event.get("documentId")
        if isinstance(document_id, str) and document_id not in seen:
            seen.add(document_id)
            document_ids.append(document_id)
    return document_ids
