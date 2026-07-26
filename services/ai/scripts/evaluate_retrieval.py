from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from rag_ai.evaluation.metrics import citation_precision, ndcg_at_k, recall_at_k


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Evaluate retrieval and citation results from a JSONL export."
    )
    parser.add_argument("--input", required=True, type=Path, help="Path to JSONL results")
    parser.add_argument("--report", type=Path, help="Optional JSON report output path")
    parser.add_argument("--min-recall", type=float, default=0.85)
    parser.add_argument("--min-ndcg", type=float, default=0.75)
    parser.add_argument("--min-citation", type=float, default=0.95)
    parser.add_argument(
        "--allow-missing-citations",
        action="store_true",
        help="Allow retrieval-only benchmarks such as SciFact to omit citation evaluation.",
    )
    return parser.parse_args()


def read_cases(path: Path) -> list[dict[str, Any]]:
    cases: list[dict[str, Any]] = []
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        try:
            case = json.loads(line)
        except json.JSONDecodeError as error:
            raise ValueError(f"Invalid JSON on line {line_number}: {error.msg}") from error
        if not isinstance(case, dict):
            raise ValueError(f"Line {line_number} must contain a JSON object")
        has_chunk_ids = all(
            isinstance(case.get(field), list) for field in ("retrievedChunkIds", "relevantChunkIds")
        )
        has_document_ids = all(
            isinstance(case.get(field), list)
            for field in ("retrievedDocumentIds", "relevantDocumentIds")
        )
        if not has_chunk_ids and not has_document_ids:
            raise ValueError(
                f"Line {line_number} requires retrieved/relevant chunk IDs or document IDs"
            )
        cases.append(case)
    if not cases:
        raise ValueError("Evaluation input must contain at least one case")
    return cases


def mean(values: list[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def build_report(cases: list[dict[str, Any]], args: argparse.Namespace) -> dict[str, Any]:
    recalls: list[float] = []
    ndcgs: list[float] = []
    citation_scores: list[float] = []

    for case in cases:
        if "retrievedChunkIds" in case:
            retrieved_ids = [str(chunk_id) for chunk_id in case["retrievedChunkIds"]]
            relevant_ids = {str(chunk_id) for chunk_id in case["relevantChunkIds"]}
        else:
            retrieved_ids = [str(document_id) for document_id in case["retrievedDocumentIds"]]
            relevant_ids = {str(document_id) for document_id in case["relevantDocumentIds"]}
        recalls.append(recall_at_k(retrieved_ids, relevant_ids, 10))
        ndcgs.append(ndcg_at_k(retrieved_ids, relevant_ids, 10))

        if "citationIds" in case and "supportedCitationIds" in case:
            citation_scores.append(
                citation_precision(
                    [str(chunk_id) for chunk_id in case["citationIds"]],
                    {str(chunk_id) for chunk_id in case["supportedCitationIds"]},
                )
            )

    metrics = {
        "recallAt10": mean(recalls),
        "ndcgAt10": mean(ndcgs),
        "citationPrecision": mean(citation_scores),
    }
    thresholds = {
        "recallAt10": args.min_recall,
        "ndcgAt10": args.min_ndcg,
        "citationPrecision": args.min_citation,
    }
    passed = (
        metrics["recallAt10"] >= thresholds["recallAt10"]
        and metrics["ndcgAt10"] >= thresholds["ndcgAt10"]
        and (
            args.allow_missing_citations
            or (
                bool(citation_scores)
                and metrics["citationPrecision"] >= thresholds["citationPrecision"]
            )
        )
    )
    return {
        "caseCount": len(cases),
        "citationCaseCount": len(citation_scores),
        "citationRequired": not args.allow_missing_citations,
        "metrics": metrics,
        "thresholds": thresholds,
        "passed": passed,
    }


def main() -> int:
    args = parse_args()
    try:
        report = build_report(read_cases(args.input), args)
    except (OSError, ValueError) as error:
        print(f"Evaluation failed: {error}")
        return 2

    rendered = json.dumps(report, ensure_ascii=False, indent=2)
    print(rendered)
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(f"{rendered}\n", encoding="utf-8")
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
