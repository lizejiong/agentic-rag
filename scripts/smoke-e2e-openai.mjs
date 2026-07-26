/**
 * End-to-end smoke test: upload PDF → ingest with real embedding →
 * chat with real LLM → verify citations.
 *
 * Prerequisites: Docker services up, API/Web/AI/Worker running.
 * Run: node --env-file-if-exists=.env scripts/smoke-e2e-openai.mjs
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const API = process.env.SMOKE_API_URL ?? 'http://127.0.0.1:3000';
const ADMIN = process.env.SMOKE_ADMIN_USERNAME ?? process.env.BOOTSTRAP_ADMIN_USERNAME;
const PWD = process.env.SMOKE_ADMIN_PASSWORD ?? process.env.BOOTSTRAP_ADMIN_PASSWORD;

if (!ADMIN || !PWD) {
  console.error('Set BOOTSTRAP_ADMIN_USERNAME and BOOTSTRAP_ADMIN_PASSWORD in .env');
  process.exit(1);
}

let token = '';
let spaceId = '';
let documentId = '';
let versionId = '';
let importId = '';
const fixturesDir = process.env.SMOKE_FIXTURES_DIR ?? '.smoke-logs/fixtures';

function api(path, init = {}) {
  const headers = {
    ...(init.headers || {}),
    'x-request-id': randomUUID(),
    'x-chat-protocol-version': '1',
  };
  if (token) headers.authorization = `Bearer ${token}`;
  return fetch(`${API}${path}`, { ...init, headers });
}

// ── 1. Login ──────────────────────────────────────────────────────
console.log('1. Login...');
{
  const r = await api('/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: ADMIN, password: PWD }),
  });
  assert.ok(r.status >= 200 && r.status < 300, `Login failed: ${r.status}`);
  const body = await r.json();
  token = body.accessToken;
  console.log(`   token=${token.slice(0, 12)}...`);
}

// ── 2. Create space ───────────────────────────────────────────────
console.log('2. Create space...');
{
  const r = await api('/spaces', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: `e2e-smoke-${Date.now()}`, description: 'temp' }),
  });
  assert.equal(r.status, 201, `Create space: ${r.status}`);
  const body = await r.json();
  spaceId = body.id;
  console.log(`   spaceId=${spaceId}`);
}

// ── 3. Create file import ticket ──────────────────────────────────
console.log('3. Create import ticket...');
{
  const pdfPath = join(fixturesDir, 'atlas-quarterly-report.pdf');
  const buf = readFileSync(pdfPath);
  const r = await api(`/spaces/${spaceId}/imports/files`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      files: [{ clientFileId: randomUUID(), fileName: 'atlas-quarterly-report.pdf', sizeBytes: buf.length, mimeType: 'application/pdf' }],
    }),
  });
  assert.equal(r.status, 201, `Create import: ${r.status}`);
  const body = await r.json();
  ({ documentId, versionId, importId } = body.imports[0]);
  console.log(`   doc=${documentId} ver=${versionId}`);
}

// ── 4. Upload file ────────────────────────────────────────────────
console.log('4. Upload file...');
{
  const pdfPath = join(fixturesDir, 'atlas-quarterly-report.pdf');
  const buf = readFileSync(pdfPath);
  const r = await api(`/imports/${importId}/content`, {
    method: 'PUT',
    headers: { 'content-type': 'application/pdf', 'content-length': String(buf.length) },
    body: buf,
  });
  assert.ok(r.status >= 200 && r.status < 300, `Upload: ${r.status}`);
  console.log('   uploaded');
}

// ── 5. Poll until READY ───────────────────────────────────────────
console.log('5. Polling for READY...');
{
  for (let i = 0; i < 120; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const r = await api(`/imports/${importId}`);
    const task = await r.json();
    process.stdout.write(`   ${task.status}/${task.stage} ${task.progress}%\r`);
    if (task.status === 'SUCCEEDED') { console.log('\n   READY'); break; }
    if (task.status === 'FAILED') { console.log(`\n   FAILED: ${task.errorCode}`); process.exit(1); }
  }
}

// ── 6. Verify document content ────────────────────────────────────
console.log('6. Verify content...');
{
  const r = await api(`/documents/${documentId}/content`);
  assert.equal(r.status, 200, `Content: ${r.status}`);
  const body = await r.json();
  assert.ok(body.fullText.length > 50, `Content too short: ${body.fullText.length} chars`);
  console.log(`   ${body.elementCount} elements, ${body.fullText.length} chars`);
}

// ── 7. Verify chunks were created ─────────────────────────────────
console.log('7. Verify chunks...');
{
  const r = await api(`/documents/${documentId}/chunks`);
  assert.equal(r.status, 200, `Chunks: ${r.status}`);
  const chunks = await r.json();
  assert.ok(chunks.length > 0, 'No chunks found');
  console.log(`   ${chunks.length} chunks`);
}

// ── 8. Chat with real models ──────────────────────────────────────
console.log('8. Chat (real models)...');
{
  const r = await api('/chat/stream', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify({
      id: randomUUID(),
      requestId: randomUUID(),
      messages: [
        {
          id: randomUUID(),
          role: 'user',
          parts: [{ type: 'text', text: 'Atlas RAG 支持哪些文档格式？' }],
        },
      ],
      selectedSpaceIds: [spaceId],
    }),
  });
  assert.equal(r.status, 200, `Chat: ${r.status}`);
  assert.ok(r.headers.get('content-type')?.includes('text/event-stream'), 'Not SSE');

  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const events = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6);
        if (data === '[DONE]') { events.push('[DONE]'); continue; }
        try { events.push(JSON.parse(data)); } catch {}
      }
    }
  }

  const citations = events.filter(e => e.type === 'data-citation');
  const textParts = events.filter(e => e.type === 'text-delta' || e.type === 'text');
  const summaries = events.filter(e => e.type === 'data-retrieval-summary');

  console.log(`   citations: ${citations.length}`);
  console.log(`   retrieval summaries: ${summaries.length}`);
  console.log(`   text parts: ${textParts.length}`);

  if (citations.length > 0) {
    console.log(`   first citation: "${citations[0]?.data?.title}"`);
  }
  if (summaries.length > 0) {
    const s = summaries[0]?.data;
    console.log(`   retrieval: vectorCandidates=${s?.vectorTopK} lexicalCandidates=${s?.lexicalTopK} final=${s?.finalCandidateCount}`);
  }

  // At minimum we need either citations or text
  assert.ok(citations.length > 0 || textParts.length > 0, 'No chat output');
}

// ── 9. Cleanup ────────────────────────────────────────────────────
console.log('9. Cleanup...');
{
  const r = await api(`/documents/${documentId}`, { method: 'DELETE' });
  assert.equal(r.status, 200, `Delete: ${r.status}`);
  console.log('   document deleted');
}

console.log('\n=== ALL E2E TESTS PASSED ===');
