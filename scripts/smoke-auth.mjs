import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const apiUrl = process.env.SMOKE_API_URL ?? 'http://127.0.0.1:3000';
const adminUsername =
  process.env.SMOKE_ADMIN_USERNAME ?? process.env.BOOTSTRAP_ADMIN_USERNAME;
const adminPassword =
  process.env.SMOKE_ADMIN_PASSWORD ?? process.env.BOOTSTRAP_ADMIN_PASSWORD;

assert(adminUsername, 'Set SMOKE_ADMIN_USERNAME or BOOTSTRAP_ADMIN_USERNAME.');
assert(adminPassword, 'Set SMOKE_ADMIN_PASSWORD or BOOTSTRAP_ADMIN_PASSWORD.');

const suffix = randomUUID().slice(0, 8);
const memberUsername = `smoke-member-${suffix}`;
const memberPassword = `Smoke-Member-${suffix}-Password-01`;
const admin = await login(adminUsername, adminPassword);
const member = await json('/users', {
  method: 'POST',
  token: admin.accessToken,
  body: {
    username: memberUsername,
    displayName: `Smoke Member ${suffix}`,
    password: memberPassword,
    role: 'MEMBER',
  },
});
const space = await json('/spaces', {
  method: 'POST',
  token: admin.accessToken,
  body: { name: `Smoke Knowledge ${suffix}` },
});
const grant = await json(`/spaces/${space.id}/grants`, {
  method: 'PUT',
  token: admin.accessToken,
  body: {
    subjectType: 'USER',
    subjectId: member.id,
    permission: 'VIEW',
  },
});
const memberSession = await login(memberUsername, memberPassword);
const spaces = await json('/spaces', { token: memberSession.accessToken });
assert(spaces.some((candidate) => candidate.id === space.id));

const requestId = randomUUID();
const chat = await fetch(`${apiUrl}/chat/stream`, {
  method: 'POST',
  headers: {
    authorization: `Bearer ${memberSession.accessToken}`,
    'content-type': 'application/json',
    'x-chat-protocol-version': '1',
    'x-trace-id': `smoke-auth-${requestId}`,
  },
  body: JSON.stringify({
    id: `smoke-auth-${suffix}`,
    requestId,
    selectedSpaceIds: [space.id],
    messages: [
      {
        id: `smoke-auth-question-${suffix}`,
        role: 'user',
        parts: [{ type: 'text', text: '验证真实登录与授权链路' }],
      },
    ],
  }),
});
const chatBody = await chat.text();
assert.equal(chat.status, 200, chatBody);
assert.match(chatBody, /text-delta/);

await json(`/spaces/${space.id}/grants/${grant.id}`, {
  method: 'DELETE',
  token: admin.accessToken,
  expectedStatus: 204,
});
await json(`/spaces/${space.id}`, {
  token: memberSession.accessToken,
  expectedStatus: 403,
});

await json(`/spaces/${space.id}/status`, {
  method: 'PATCH',
  token: admin.accessToken,
  body: { status: 'ARCHIVED' },
});
await json(`/users/${member.id}/status`, {
  method: 'PATCH',
  token: admin.accessToken,
  body: { status: 'DISABLED' },
});

console.log('Authenticated Phase 1 smoke test passed.');

async function login(username, password) {
  return json('/auth/login', {
    method: 'POST',
    body: { username, password },
  });
}

async function json(
  path,
  { method = 'GET', token, body, expectedStatus } = {},
) {
  const response = await fetch(`${apiUrl}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
      'x-request-id': randomUUID(),
      'x-trace-id': randomUUID(),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const expected = expectedStatus ?? (method === 'POST' ? 201 : 200);
  const text = await response.text();
  assert.equal(response.status, expected, `${method} ${path}: ${text}`);
  return text ? JSON.parse(text) : undefined;
}
