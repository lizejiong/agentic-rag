/**
 * Real multi-format document upload smoke test.
 *
 * Prerequisites:
 *   - Infrastructure running (postgres, redis, minio, clamav): pnpm infra:up
 *   - NestJS API on :3000 and the Python ingestion worker running
 *   - Fixtures generated: uv run --project services/ai python scripts/generate-smoke-fixtures.py
 *
 * Run: node --env-file-if-exists=.env scripts/smoke-documents.mjs
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const apiUrl = process.env.SMOKE_API_URL ?? 'http://127.0.0.1:3000';
const fixturesDir = process.env.SMOKE_FIXTURES_DIR ?? '.smoke-logs/fixtures';
const adminUsername =
  process.env.SMOKE_ADMIN_USERNAME ?? process.env.BOOTSTRAP_ADMIN_USERNAME;
const adminPassword =
  process.env.SMOKE_ADMIN_PASSWORD ?? process.env.BOOTSTRAP_ADMIN_PASSWORD;

assert(adminUsername, 'Set SMOKE_ADMIN_USERNAME or BOOTSTRAP_ADMIN_USERNAME.');
assert(adminPassword, 'Set SMOKE_ADMIN_PASSWORD or BOOTSTRAP_ADMIN_PASSWORD.');

const OPENXML = 'application/vnd.openxmlformats-officedocument';
const GOOD_FILES = [
  { file: 'atlas-quarterly-report.pdf', mime: 'application/pdf' },
  { file: '产品需求文档.docx', mime: `${OPENXML}.wordprocessingml.document` },
  { file: '季度销售数据.xlsx', mime: `${OPENXML}.spreadsheetml.sheet` },
  { file: '项目进展汇报.pptx', mime: `${OPENXML}.presentationml.presentation` },
  { file: '会议纪要.txt', mime: 'text/plain' },
  { file: 'architecture-overview.md', mime: 'text/markdown' },
  { file: '员工名录.csv', mime: 'text/csv' },
  { file: '知识库配置.json', mime: 'application/json' },
];
const REJECTED_FILES = [
  { file: 'corrupted.pdf', mime: 'application/pdf', codes: ['DOCUMENT_PARSE_FAILED'] },
  {
    file: 'disguised.docx',
    mime: `${OPENXML}.wordprocessingml.document`,
    codes: ['FILE_SIGNATURE_MISMATCH'],
  },
  { file: 'eicar-test.txt', mime: 'text/plain', codes: ['VIRUS_FOUND'] },
];

const TERMINAL = new Set(['SUCCEEDED', 'FAILED', 'CANCELLED']);
const suffix = randomUUID().slice(0, 8);
const admin = await json('/auth/login', {
  method: 'POST',
  body: { username: adminUsername, password: adminPassword },
});
const token = admin.accessToken;

const space = await json('/spaces', {
  method: 'POST',
  token,
  body: { name: `Smoke Documents ${suffix}` },
});
console.log(`space: ${space.id}`);

// --- API-level rejection checks ------------------------------------------------
await expectApiError(
  `/spaces/${space.id}/imports/files`,
  {
    files: [
      {
        clientFileId: randomUUID(),
        fileName: 'oversized-notes.txt',
        sizeBytes: 150 * 1024 * 1024,
        mimeType: 'text/plain',
      },
    ],
  },
  'DOCUMENT_SIZE_LIMIT_EXCEEDED',
);
await expectApiError(
  `/spaces/${space.id}/imports/files`,
  {
    files: [
      {
        clientFileId: randomUUID(),
        fileName: 'payload.exe',
        sizeBytes: 1024,
        mimeType: 'application/octet-stream',
      },
    ],
  },
  'UNSUPPORTED_DOCUMENT_FORMAT',
);
console.log('api rejection checks passed (size limit, unsupported format)');

// --- Happy path: one batch with every supported format -------------------------
const goodResults = await runBatch(GOOD_FILES, 'SUCCEEDED');

// --- Quarantine pipeline rejections --------------------------------------------
const rejectedResults = await runBatch(REJECTED_FILES, 'FAILED');
for (const { task, expectation } of rejectedResults) {
  assert(
    expectation.codes.includes(task.errorCode),
    `${expectation.file}: expected ${expectation.codes}, got ${task.errorCode} (${task.errorMessage})`,
  );
  console.log(`rejected as expected: ${expectation.file} -> ${task.errorCode}`);
}

// --- Document list reflects publication -----------------------------------------
const documents = await json(`/spaces/${space.id}/documents`, { token });
assert.equal(documents.length, GOOD_FILES.length + REJECTED_FILES.length);
for (const { task, expectation } of goodResults) {
  const document = documents.find((candidate) => candidate.id === task.documentId);
  assert(document, `document ${task.documentId} missing from list`);
  assert.equal(document.availability, 'ACTIVE', `${expectation.file} not ACTIVE`);
  assert.equal(
    document.latestVersion?.processingStatus,
    'READY',
    `${expectation.file} version not READY`,
  );
  assert.ok(document.activeVersionId, `${expectation.file} missing activeVersionId`);
  assert.match(document.latestVersion.contentHash ?? '', /^[a-f0-9]{64}$/);
}
for (const { task, expectation } of rejectedResults) {
  const document = documents.find((candidate) => candidate.id === task.documentId);
  assert(document, `rejected document ${task.documentId} missing from list`);
  assert.equal(document.availability, 'DRAFT', `${expectation.file} must stay DRAFT`);
  assert.equal(document.activeVersionId, null, `${expectation.file} must have no active version`);
}

console.log('');
console.log('file\tstatus\terror');
for (const { task, expectation } of [...goodResults, ...rejectedResults]) {
  console.log(`${expectation.file}\t${task.status}\t${task.errorCode ?? ''}`);
}
console.log('');
console.log(`Multi-format upload smoke passed: ${GOOD_FILES.length} formats READY, ` +
  `${REJECTED_FILES.length} rejections verified.`);

async function runBatch(expectations, terminalStatus) {
  const byClientFileId = new Map(
    expectations.map((expectation) => [randomUUID(), expectation]),
  );
  const batch = await json(`/spaces/${space.id}/imports/files`, {
    method: 'POST',
    token,
    body: {
      files: [...byClientFileId].map(([clientFileId, { file, mime }]) => ({
        clientFileId,
        fileName: file,
        sizeBytes: statSize(file),
        mimeType: mime,
      })),
    },
  });
  assert.equal(batch.imports.length, expectations.length);

  const tickets = batch.imports.map((ticket) => {
    const expectation = byClientFileId.get(ticket.clientFileId);
    assert(expectation, `unexpected clientFileId ${ticket.clientFileId}`);
    return { ticket, expectation };
  });
  // Upload at most three files concurrently, matching the browser client.
  const queue = [...tickets];
  await Promise.all(
    Array.from({ length: 3 }, async () => {
      while (queue.length > 0) {
        const item = queue.shift();
        await upload(item.ticket, item.expectation);
      }
    }),
  );

  const deadline = Date.now() + 15 * 60 * 1000;
  const results = [];
  for (const { ticket, expectation } of tickets) {
    const task = await pollTask(ticket.importId, deadline);
    assert.equal(
      task.status,
      terminalStatus,
      `${expectation.file}: expected ${terminalStatus}, got ${task.status} ` +
        `(${task.errorCode}: ${task.errorMessage})`,
    );
    results.push({ task, expectation });
  }
  return results;
}

function statSize(file) {
  return readFileSync(join(fixturesDir, file)).length;
}

async function upload(ticket, expectation) {
  const bytes = readFileSync(join(fixturesDir, expectation.file));
  const response = await fetch(`${apiUrl}${ticket.uploadPath}`, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': expectation.mime,
      'content-length': String(bytes.length),
      'x-request-id': randomUUID(),
    },
    body: bytes,
  });
  const text = await response.text();
  assert.equal(response.status, 200, `upload ${expectation.file}: ${text}`);
  const result = JSON.parse(text);
  assert.equal(result.status, 'QUEUED');
  assert.equal(result.sizeBytes, bytes.length);
  console.log(`uploaded: ${expectation.file} (${bytes.length} bytes, sha256 ${result.contentHash.slice(0, 12)}…)`);
}

async function pollTask(importId, deadline) {
  for (;;) {
    const task = await json(`/imports/${importId}`, { token });
    if (TERMINAL.has(task.status)) {
      return task;
    }
    assert(Date.now() < deadline, `import ${importId} did not finish in time`);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

async function expectApiError(path, body, code) {
  const response = await fetch(`${apiUrl}${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  assert.equal(response.status, 400, `${path}: ${text}`);
  assert(text.includes(code), `${path}: expected ${code}, got ${text}`);
}

async function json(path, { method = 'GET', token: authToken, body } = {}) {
  const response = await fetch(`${apiUrl}${path}`, {
    method,
    headers: {
      ...(authToken ? { authorization: `Bearer ${authToken}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
      'x-request-id': randomUUID(),
      'x-trace-id': randomUUID(),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const expected = method === 'POST' ? 201 : 200;
  const text = await response.text();
  assert.equal(response.status, expected, `${method} ${path}: ${text}`);
  return text ? JSON.parse(text) : undefined;
}
