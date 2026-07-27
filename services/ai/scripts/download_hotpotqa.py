from __future__ import annotations

import argparse
import json
import shutil
import ssl
import time
import urllib.request
from pathlib import Path

import certifi

HOTPOTQA_DEV_URL = "https://curtis.ml.cmu.edu/datasets/hotpot/hotpot_dev_distractor_v1.json"
HUGGING_FACE_ROWS_URL = "https://datasets-server.huggingface.co/rows"


def download_from_hugging_face(output: Path, limit: int, offset: int, context: ssl.SSLContext) -> None:
    query = urllib.parse.urlencode(
        {
            "dataset": "hotpotqa/hotpot_qa",
            "config": "distractor",
            "split": "validation",
            "offset": offset,
            "length": limit,
        }
    )
    request = urllib.request.Request(
        f"{HUGGING_FACE_ROWS_URL}?{query}", headers={"User-Agent": "rag-evaluation/1.0"}
    )
    with urllib.request.urlopen(request, context=context, timeout=120) as response:
        payload = json.load(response)

    rows = []
    for item in payload["rows"]:
        row = item["row"]
        rows.append(
            {
                "_id": row["id"],
                "question": row["question"],
                "answer": row["answer"],
                "supporting_facts": list(
                    zip(row["supporting_facts"]["title"], row["supporting_facts"]["sent_id"], strict=True)
                ),
                "context": list(
                    zip(row["context"]["title"], row["context"]["sentences"], strict=True)
                ),
            }
        )
    output.write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Download HotpotQA distractor validation data.")
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--source", choices=("huggingface", "official"), default="huggingface")
    parser.add_argument("--limit", type=int, default=20)
    parser.add_argument("--offset", type=int, default=0)
    args = parser.parse_args()
    if args.output.exists():
        print(f"Refusing to overwrite existing file: {args.output}")
        return 2
    args.output.parent.mkdir(parents=True, exist_ok=True)
    context = ssl.create_default_context(cafile=certifi.where())
    if args.source == "huggingface":
        download_from_hugging_face(args.output, args.limit, args.offset, context)
        print(f"Downloaded {args.limit} HotpotQA validation cases from Hugging Face to {args.output}")
        return 0

    request = urllib.request.Request(HOTPOTQA_DEV_URL, headers={"User-Agent": "rag-evaluation/1.0"})
    for attempt in range(1, 4):
        try:
            with urllib.request.urlopen(request, context=context, timeout=120) as response:
                with args.output.open("wb") as destination:
                    shutil.copyfileobj(response, destination)
            break
        except OSError:
            args.output.unlink(missing_ok=True)
            if attempt == 3:
                raise
            time.sleep(attempt * 2)
    print(f"HotpotQA saved to {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
