from __future__ import annotations

import argparse
from pathlib import Path

from rag_ai.evaluation.beir import load_scifact_cases, write_jsonl


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Convert BEIR SciFact qrels into evaluation cases.")
    parser.add_argument("--dataset-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--limit", type=int, default=50)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    cases = load_scifact_cases(args.dataset_dir, args.limit)
    if not cases:
        print("No SciFact test cases were found")
        return 1
    write_jsonl(cases, args.output)
    print(f"Wrote {len(cases)} SciFact evaluation cases to {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
