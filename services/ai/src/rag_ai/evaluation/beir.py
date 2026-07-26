from __future__ import annotations

import csv
import json
from collections import defaultdict
from pathlib import Path
from typing import Any


def load_scifact_cases(dataset_dir: Path, limit: int | None = None) -> list[dict[str, Any]]:
    queries = _load_queries(dataset_dir / "queries.jsonl")
    qrels = _load_qrels(dataset_dir / "qrels" / "test.tsv")
    cases = [
        {
            "id": f"scifact:{query_id}",
            "query": query,
            "relevantDocumentIds": sorted(qrels[query_id]),
            "sourceDataset": "BEIR SciFact",
            "license": "CC-BY-SA-4.0",
        }
        for query_id, query in sorted(queries.items())
        if query_id in qrels
    ]
    return cases if limit is None else cases[:limit]


def write_jsonl(cases: list[dict[str, Any]], output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        "".join(json.dumps(case, ensure_ascii=False) + "\n" for case in cases),
        encoding="utf-8",
    )


def _load_queries(path: Path) -> dict[str, str]:
    queries: dict[str, str] = {}
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        row = json.loads(line)
        query_id = row.get("_id")
        query_text = row.get("text")
        if not isinstance(query_id, str) or not isinstance(query_text, str):
            raise ValueError(f"Invalid query record on line {line_number}")
        queries[query_id] = query_text
    return queries


def _load_qrels(path: Path) -> dict[str, set[str]]:
    qrels: dict[str, set[str]] = defaultdict(set)
    with path.open(encoding="utf-8", newline="") as source:
        for row in csv.DictReader(source, delimiter="\t"):
            query_id = row.get("query-id")
            document_id = row.get("corpus-id")
            score = row.get("score")
            if query_id and document_id and score and int(score) > 0:
                qrels[query_id].add(document_id)
    return qrels
