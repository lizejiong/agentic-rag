from __future__ import annotations

import argparse
import json
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any
from uuid import uuid4

from rag_ai.evaluation.citations import citation_document_ids


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run evaluation questions through the agent and collect citations.")
    parser.add_argument("--cases", required=True, type=Path)
    parser.add_argument("--document-map", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--ai-url", default="http://127.0.0.1:8001")
    parser.add_argument("--space-id", required=True)
    parser.add_argument("--user-id", required=True)
    parser.add_argument("--relevant-document-key", default="relevantDocumentIds")
    parser.add_argument("--limit", type=int)
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


def run_agent(*, ai_url: str, space_id: str, user_id: str, question: str) -> list[dict[str, object]]:
    request_id = uuid4()
    payload = json.dumps(
        {
            "requestId": str(request_id),
            "traceId": f"evaluation-{request_id}",
            "actorId": user_id,
            "question": question,
            "selectedSpaceIds": [space_id],
            "aclSnapshot": {"userId": user_id, "spaces": {space_id: "VIEW"}},
            "history": [],
        }
    ).encode("utf-8")
    request = urllib.request.Request(
        f"{ai_url.rstrip('/')}/v1/agent/runs",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        return [
            event
            for line in response.read().decode("utf-8").splitlines()
            if line and isinstance(event := json.loads(line), dict)
        ]


def main() -> int:
    args = parse_args()
    try:
        cases = read_jsonl(args.cases)
        source_to_internal = load_document_map(args.document_map)
        internal_to_source = {internal: source for source, internal in source_to_internal.items()}
        results: list[dict[str, Any]] = []
        for case in cases[: args.limit]:
            question = case.get("query")
            relevant_ids = case.get(args.relevant_document_key)
            if not isinstance(question, str) or not isinstance(relevant_ids, list):
                raise ValueError(
                    f"Evaluation case requires query and {args.relevant_document_key}"
                )
            citation_ids = [
                internal_to_source[document_id]
                for document_id in citation_document_ids(
                    run_agent(
                        ai_url=args.ai_url,
                        space_id=args.space_id,
                        user_id=args.user_id,
                        question=question,
                    )
                )
                if document_id in internal_to_source
            ]
            results.append(
                {
                    "id": case.get("id"),
                    "retrievedDocumentIds": citation_ids,
                    "relevantDocumentIds": [str(document_id) for document_id in relevant_ids],
                    "citationIds": citation_ids,
                    "supportedCitationIds": [str(document_id) for document_id in relevant_ids],
                }
            )
    except (OSError, ValueError, urllib.error.URLError) as error:
        print(f"SciFact citation run failed: {error}")
        return 2

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        "".join(json.dumps(result, ensure_ascii=False) + "\n" for result in results),
        encoding="utf-8",
    )
    print(f"Wrote {len(results)} citation results to {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
