from __future__ import annotations

import argparse
import json
import os
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from typing import Any


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Import an evaluation corpus into an isolated space.")
    parser.add_argument("--corpus", required=True, type=Path)
    parser.add_argument("--document-map-output", required=True, type=Path)
    parser.add_argument("--space-id", required=True)
    parser.add_argument("--username", required=True)
    parser.add_argument("--password-env", default="RAG_EVALUATION_PASSWORD")
    parser.add_argument("--api-url", default="http://127.0.0.1:3000")
    parser.add_argument("--limit", type=int)
    return parser.parse_args()


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line]


def request_json(
    url: str, *, method: str, access_token: str, body: dict[str, Any] | None = None
) -> dict[str, Any]:
    data = json.dumps(body).encode("utf-8") if body is not None else None
    request = urllib.request.Request(
        url,
        data=data,
        headers={
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
        },
        method=method,
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        result = json.load(response)
    if not isinstance(result, dict):
        raise ValueError(f"Expected JSON object from {url}")
    return result


def login(api_url: str, username: str, password: str) -> str:
    request = urllib.request.Request(
        f"{api_url.rstrip('/')}/auth/login",
        data=json.dumps({"username": username, "password": password}).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        result = json.load(response)
    access_token = result.get("accessToken") if isinstance(result, dict) else None
    if not isinstance(access_token, str):
        raise ValueError("Login response did not include an access token")
    return access_token


def upload_document(
    *, api_url: str, access_token: str, space_id: str, source_id: str, title: str, text: str
) -> tuple[str, str]:
    content = f"# {title}\n\n{text}".encode("utf-8")
    ticket_response = request_json(
        f"{api_url.rstrip('/')}/spaces/{space_id}/imports/files",
        method="POST",
        access_token=access_token,
        body={
            "files": [
                {
                    "clientFileId": str(uuid.uuid4()),
                    "fileName": f"evaluation-{source_id}.md",
                    "sizeBytes": len(content),
                    "mimeType": "text/markdown",
                }
            ]
        },
    )
    ticket = ticket_response["imports"][0]
    upload_request = urllib.request.Request(
        f"{api_url.rstrip('/')}{ticket['uploadPath']}",
        data=content,
        headers={
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "text/markdown",
            "Content-Length": str(len(content)),
        },
        method="PUT",
    )
    with urllib.request.urlopen(upload_request, timeout=60):
        pass
    return str(ticket["documentId"]), str(ticket["importId"])


def wait_for_import(api_url: str, access_token: str, import_id: str) -> None:
    for _ in range(480):
        task = request_json(
            f"{api_url.rstrip('/')}/imports/{import_id}",
            method="GET",
            access_token=access_token,
        )
        if task.get("status") == "SUCCEEDED":
            return
        if task.get("status") in {"FAILED", "CANCELLED"}:
            raise ValueError(task.get("errorCode") or f"Import {task['status']}")
        time.sleep(0.75)
    raise TimeoutError(f"Import did not finish: {import_id}")


def main() -> int:
    args = parse_args()
    password = os.getenv(args.password_env)
    if not password:
        print(f"Set {args.password_env} before running this script.")
        return 2

    try:
        access_token = login(args.api_url, args.username, password)
        existing = {
            str(row["sourceDocumentId"]): str(row["documentId"])
            for row in read_jsonl(args.document_map_output)
        } if args.document_map_output.exists() else {}
        rows = read_jsonl(args.corpus)[: args.limit]
        for index, row in enumerate(rows, start=1):
            source_id = row.get("sourceDocumentId")
            title = row.get("title")
            text = row.get("text")
            if not all(isinstance(value, str) for value in (source_id, title, text)):
                raise ValueError("Corpus rows require sourceDocumentId, title, and text strings")
            if source_id in existing:
                continue
            document_id, import_id = upload_document(
                api_url=args.api_url,
                access_token=access_token,
                space_id=args.space_id,
                source_id=source_id,
                title=title,
                text=text,
            )
            wait_for_import(args.api_url, access_token, import_id)
            existing[source_id] = document_id
            args.document_map_output.parent.mkdir(parents=True, exist_ok=True)
            args.document_map_output.write_text(
                "".join(
                    json.dumps({"sourceDocumentId": key, "documentId": value}, ensure_ascii=False) + "\n"
                    for key, value in existing.items()
                ),
                encoding="utf-8",
            )
            print(f"Imported {index}/{len(rows)}")
    except (OSError, ValueError, urllib.error.URLError, TimeoutError) as error:
        print(f"Evaluation corpus import failed: {error}")
        return 2

    print(f"Imported {len(existing)} documents to {args.space_id}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
