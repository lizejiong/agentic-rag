import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const requestId = randomUUID();
const response = await fetch('http://127.0.0.1:3000/chat/stream', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-chat-protocol-version': '1',
    'x-trace-id': `smoke-${requestId}`,
  },
  body: JSON.stringify({
    id: 'smoke-conversation',
    requestId,
    selectedSpaceIds: [],
    messages: [
      {
        id: 'smoke-user-message',
        role: 'user',
        parts: [{ type: 'text', text: '验证流式协议' }],
      },
    ],
  }),
});

assert.equal(response.status, 200);
assert.equal(response.headers.get('x-vercel-ai-ui-message-stream'), 'v1');
const body = await response.text();
assert.match(body, /text-delta/);
assert.match(body, /data-citation/);
assert.match(body, /data: \[DONE\]/);
console.log('Chat stream smoke test passed.');
