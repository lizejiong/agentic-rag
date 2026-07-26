from __future__ import annotations

import argparse
import shutil
import ssl
import tempfile
import urllib.request
import zipfile
from pathlib import Path

import certifi

SCIFACT_URL = "https://public.ukp.informatik.tu-darmstadt.de/thakur/BEIR/datasets/scifact.zip"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Download the BEIR SciFact benchmark dataset.")
    parser.add_argument("--output", type=Path, required=True, help="Directory for the extracted dataset")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.output.exists() and any(args.output.iterdir()):
        print(f"Refusing to overwrite non-empty directory: {args.output}")
        return 2

    args.output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as temporary_directory:
        archive_path = Path(temporary_directory) / "scifact.zip"
        print(f"Downloading {SCIFACT_URL}")
        context = ssl.create_default_context(cafile=certifi.where())
        with urllib.request.urlopen(SCIFACT_URL, context=context) as response:
            archive_path.write_bytes(response.read())
        with zipfile.ZipFile(archive_path) as archive:
            archive.extractall(args.output)

    nested_dataset = args.output / "scifact"
    if nested_dataset.exists():
        for item in nested_dataset.iterdir():
            shutil.move(str(item), args.output / item.name)
        nested_dataset.rmdir()
    required_paths = [args.output / "corpus.jsonl", args.output / "queries.jsonl", args.output / "qrels" / "test.tsv"]
    if not all(path.exists() for path in required_paths):
        print("Downloaded archive does not have the expected BEIR SciFact layout")
        return 1
    print(f"SciFact extracted to {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
