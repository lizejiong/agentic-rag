from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows), encoding="utf-8"
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Prepare a fixed HotpotQA evidence subset.")
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--cases-output", required=True, type=Path)
    parser.add_argument("--corpus-output", required=True, type=Path)
    parser.add_argument("--limit", type=int, default=20)
    args = parser.parse_args()

    rows = json.loads(args.input.read_text(encoding="utf-8"))[: args.limit]
    cases: list[dict[str, Any]] = []
    corpus: dict[str, str] = {}
    for row in rows:
        context = {title: sentences for title, sentences in row["context"]}
        supported_titles = sorted({title for title, _ in row["supporting_facts"]})
        cases.append(
            {
                "id": f"hotpotqa:{row['_id']}",
                "query": row["question"],
                "expectedAnswer": row["answer"],
                "supportedDocumentIds": supported_titles,
                "sourceDataset": "HotpotQA distractor dev",
                "license": "CC-BY-SA-4.0",
            }
        )
        for title, sentences in context.items():
            corpus.setdefault(title, "\n".join(sentences))
    write_jsonl(args.cases_output, cases)
    write_jsonl(
        args.corpus_output,
        [{"sourceDocumentId": title, "title": title, "text": text} for title, text in corpus.items()],
    )
    print(f"Wrote {len(cases)} cases and {len(corpus)} documents")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
