# Document ingestion operations

Phase 2A provides durable file ingestion for PDF, DOCX, XLSX, PPTX, TXT, Markdown, CSV, and JSON. Phase 2B adds secure public single-page URL capture. Legacy DOC/XLS/PPT conversion and OCR remain in the next hardening increment because they require separately sandboxed LibreOffice and OCR processes.

## Processing path

1. NestJS creates a permanent `Document`, immutable `DocumentVersion`, and `ImportTask`.
2. The browser streams bytes to the quarantine MinIO bucket. NestJS verifies the declared length and calculates SHA-256 without buffering the file.
3. A transactional outbox publishes `document.ingestion.requested.v1` with an ACL snapshot.
4. The Python worker verifies size/hash, scans with ClamAV, validates the container, normalizes the document, and stores elements/chunks in the `rag` schema.
5. NestJS consumes the result event, promotes the object to a content-addressed key, and atomically changes the active version. A failed candidate never replaces an existing active version.

The permanent task state lives in PostgreSQL. Redis Streams are replayable transport and are not the source of truth.

### URL capture path

1. NestJS stores the URL document, candidate version, task, and `document.url.capture.requested.v1` outbox event in one transaction.
2. The URL consumer resolves every hostname and requires every A/AAAA answer to be globally routable. Each request is pinned to the checked address, so a second DNS lookup cannot redirect the connection.
3. Redirects are followed manually and each hop repeats protocol, DNS, and address checks. Requests never forward browser/server Cookie, Authorization, or proxy credentials.
4. Responses are limited to HTML/XHTML/plain text, five redirects, 30 seconds, and 20 MB. Readability extracts the main article and Turndown preserves useful Markdown structure.
5. The extracted Markdown enters the same MinIO quarantine, ClamAV, normalization, chunking, and atomic publication path as uploaded text files.

The first URL release does not run JavaScript, crawl linked pages, use login state, or schedule refreshes. Pages that require JavaScript, authentication, or anti-bot challenges fail with `URL_CONTENT_EMPTY`; refresh is manual. An unchanged refresh updates the source check time and keeps the current active version.

## Required services and configuration

Copy `infra/compose/.env.example` to `infra/compose/.env`, then run:

```powershell
pnpm infra:up
pnpm db:migrate:app
pnpm db:migrate:rag
pnpm db:seed
```

The ingestion worker needs `DATABASE_URL`, `REDIS_URL`, MinIO credentials, `CLAMAV_HOST`, `CLAMAV_PORT`, and `CLAMAV_REQUIRED=true`. Compose supplies these values. ClamAV downloads signature data on its first start, so readiness can take around two minutes.

Run the services in separate terminals:

```powershell
pnpm dev:api
pnpm dev:ai
uv run --project services/ai python -m rag_ai.worker_main
pnpm dev:web
```

Open a knowledge space's document page at `/spaces/{spaceId}/documents`. One batch accepts at most 100 files; the browser sends at most three files concurrently. Text/JSON/CSV/Markdown files are limited to 100 MiB and other enabled formats to 200 MiB.

Set `URL_CAPTURE_MAX_BYTES=20971520`, `URL_CAPTURE_MAX_REDIRECTS=5`, and `URL_CAPTURE_TIMEOUT_MS=30000` for the default URL safety limits. Production deployments should restrict API egress with network policy as a second layer; the application-level IP policy remains mandatory.

## Stable failure codes

| Code                              | Meaning                                                                                 | Action                                                   |
| --------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `VIRUS_FOUND`                     | ClamAV detected malware                                                                 | Do not retry the same content                            |
| `VIRUS_SCANNER_UNAVAILABLE`       | clamd was unavailable                                                                   | Restore ClamAV; the event remains retryable              |
| `FILE_SIGNATURE_MISMATCH`         | Extension and bytes disagree                                                            | Export the source again in the declared format           |
| `ARCHIVE_PATH_TRAVERSAL`          | Unsafe Office ZIP member                                                                | Reject and investigate the source                        |
| `ARCHIVE_RESOURCE_LIMIT_EXCEEDED` | ZIP expansion safety limit                                                              | Reduce or re-export the file                             |
| `ENCRYPTED_DOCUMENT_UNSUPPORTED`  | Password-protected file                                                                 | Decrypt before upload                                    |
| `DOCUMENT_PARSE_FAILED`           | Parser rejected valid-looking content                                                   | Inspect worker logs using `traceId`                      |
| `DOCUMENT_PROCESSING_TIMEOUT`     | Parser exceeded its deadline                                                            | Retry once; split unusually large files                  |
| `INGESTION_STALLED`               | Reconciliation exhausted retries                                                        | Inspect Redis, worker, and PostgreSQL                    |
| `URL_ADDRESS_BLOCKED`             | DNS returned a private, loopback, link-local, reserved, or mixed public/private address | Reject the URL; do not bypass the policy                 |
| `URL_REDIRECT_LIMIT_EXCEEDED`     | More than five redirects were required                                                  | Import the final public page URL directly                |
| `URL_RESPONSE_TOO_LARGE`          | Response exceeded 20 MB                                                                 | Use a smaller source page or upload an exported document |
| `URL_CONTENT_EMPTY`               | No readable server-rendered body was found                                              | Export the page or use a non-JavaScript public source    |

Error events contain codes and safe messages only; document contents and stack traces are not sent through Redis.

## Recovery and diagnostics

```powershell
docker compose --env-file infra/compose/.env -f infra/compose/compose.yaml ps
docker compose --env-file infra/compose/.env -f infra/compose/compose.yaml logs ai-worker clamav redis minio
pnpm infra:check
```

The API reconciliation service checks stale `QUEUED`/`RUNNING` tasks. If a requested event has no RAG ingestion run, it requeues the durable outbox event up to the task retry limit; otherwise it waits for the worker result or converges the task to `FAILED`.

Permanent objects use `sha256/{first-two-characters}/{full-hash}` in `MINIO_DOCUMENT_BUCKET`. Quarantine keys use `imports/{importId}` and are deleted after successful publication. Content-addressed promotion is idempotent, so a retry after a database rollback is safe.
