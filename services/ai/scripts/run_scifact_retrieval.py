from __future__ import annotations

import argparse
import json
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run BEIR SciFact queries against the retrieval API.")
    parser.add_argument("--cases", required=True, type=Path)
    parser.add_argument("--document-map", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--ai-url", default="http://127.0.0.1:8001")
    parser.add_argument("--space-id", required=True)
    parser.add_argument("--user-id", required=True)
    parser.add_argument("--limit", type=int)
    parser.add_argument("--max-results", type=int, default=10)
    return parser.parse_args()


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line]


def load_document_map(path: Path) -> dict[str, str]:
    source_to_internal: dict[str, str] = {}
    for row in read_jsonl(path):
        source_id = row.get("sourceDocumentId")
        document_id = row.get("documentId")
        if not isinstance(source_id, str) or not isinstance(document_id, str):
            raise ValueError("Document map rows require sourceDocumentId and documentId strings")
        source_to_internal[source_id] = document_id
    return source_to_internal


def query_retrieval(
    *, ai_url: str, space_id: str, user_id: str, query: str, max_results: int
) -> list[str]:
    payload = json.dumps(
        {
            "query": query,
            "selectedSpaceIds": [space_id],
            "aclSnapshot": {"userId": user_id, "spaces": {space_id: "VIEW"}},
            "maxResults": max_results,
        }
    ).encode("utf-8")
    request = urllib.request.Request(
        f"{ai_url.rstrip('/')}/v1/retrieval/test",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        body = json.loads(response.read().decode("utf-8"))
    results = body.get("results")
    if not isinstance(results, list):
        raise ValueError("Retrieval response is missing results")
    return [str(result["documentId"]) for result in results if isinstance(result, dict)]


def unique_in_order(document_ids: list[str]) -> list[str]:
    seen: set[str] = set()
    return [
        document_id
        for document_id in document_ids
        if not (document_id in seen or seen.add(document_id))
    ]


def main() -> int:
    args = parse_args()
    try:
        cases = read_jsonl(args.cases)
        source_to_internal = load_document_map(args.document_map)
        internal_to_source = {internal: source for source, internal in source_to_internal.items()}
        results: list[dict[str, Any]] = []
        for case in cases[: args.limit]:
            query = case.get("query")
            relevant_ids = case.get("relevantDocumentIds")
            if not isinstance(query, str) or not isinstance(relevant_ids, list):
                raise ValueError("SciFact case requires query and relevantDocumentIds")
            retrieved_internal_ids = query_retrieval(
                ai_url=args.ai_url,
                space_id=args.space_id,
                user_id=args.user_id,
                query=query,
                max_results=args.max_results,
            )
            results.append(
                {
                    "id": case.get("id"),
                    "retrievedDocumentIds": [
                        internal_to_source[document_id]
                        for document_id in unique_in_order(retrieved_internal_ids)
                        if document_id in internal_to_source
                    ],
                    "relevantDocumentIds": [str(document_id) for document_id in relevant_ids],
                }
            )
    except (OSError, ValueError, urllib.error.URLError) as error:
        print(f"SciFact retrieval run failed: {error}")
        return 2

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        "".join(json.dumps(result, ensure_ascii=False) + "\n" for result in results),
        encoding="utf-8",
    )
    print(f"Wrote {len(results)} retrieval results to {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
