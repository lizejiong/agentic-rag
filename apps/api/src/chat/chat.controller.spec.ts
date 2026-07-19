import type { Server } from 'node:http';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AgentEvent, RunRequest } from '@rag/contracts';
import request from 'supertest';

import { AI_EVENT_SOURCE, type AiEventSource } from '../ai/ai-event-source';
import { ActiveRunRegistry } from './active-run.registry';
import { ChatController } from './chat.controller';

const REQUEST_ID = '00000000-0000-4000-8000-000000000010';

class FakeAiEventSource implements AiEventSource {
  lastRequest: RunRequest | undefined;
  lastSignal: AbortSignal | undefined;
  cancelledRequestId: string | undefined;

  async *run(runRequest: RunRequest, signal: AbortSignal): AsyncIterable<AgentEvent> {
    await Promise.resolve();
    this.lastRequest = runRequest;
    this.lastSignal = signal;
    const base = {
      requestId: runRequest.requestId,
      traceId: runRequest.traceId,
      occurredAt: '2026-07-18T00:00:00.000Z',
    } as const;

    yield { ...base, seq: 0, type: 'run.started' };
    yield { ...base, seq: 1, type: 'text.delta', text: '答案' };
    yield {
      ...base,
      seq: 2,
      type: 'citation',
      citationId: '00000000-0000-4000-8000-000000000011',
      title: '文档',
      snippet: '证据',
      location: { page: 1 },
    };
    yield { ...base, seq: 3, type: 'run.completed', finishReason: 'stop' };
  }

  cancel(requestId: string): Promise<void> {
    this.cancelledRequestId = requestId;
    return Promise.resolve();
  }
}

describe('ChatController', () => {
  let app: INestApplication;
  let fake: FakeAiEventSource;

  beforeEach(async () => {
    fake = new FakeAiEventSource();
    const module = await Test.createTestingModule({
      controllers: [ChatController],
      providers: [ActiveRunRegistry, { provide: AI_EVENT_SOURCE, useValue: fake }],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('streams AI SDK SSE data and preserves the request ID', async () => {
    const response = await request(app.getHttpServer() as Server)
      .post('/chat/stream')
      .set('x-trace-id', 'trace-fixed')
      .send({
        id: 'message-root',
        requestId: REQUEST_ID,
        selectedSpaceIds: [],
        messages: [
          {
            id: 'user-1',
            role: 'user',
            parts: [{ type: 'text', text: '问题' }],
          },
        ],
      })
      .expect(200);

    expect(response.headers['x-vercel-ai-ui-message-stream']).toBe('v1');
    expect(response.text).toContain('"type":"data-citation"');
    expect(response.text).toContain('data: [DONE]');
    expect(fake.lastRequest).toEqual(
      expect.objectContaining({
        requestId: REQUEST_ID,
        traceId: 'trace-fixed',
        question: '问题',
      }),
    );
  });

  it('rejects a request without a user text question', async () => {
    await request(app.getHttpServer() as Server)
      .post('/chat/stream')
      .send({
        id: 'message-root',
        requestId: REQUEST_ID,
        messages: [
          {
            id: 'assistant-1',
            role: 'assistant',
            parts: [{ type: 'text', text: 'answer' }],
          },
        ],
      })
      .expect(400);

    expect(fake.lastRequest).toBeUndefined();
  });

  it('forwards explicit cancellation', async () => {
    await request(app.getHttpServer() as Server)
      .post(`/chat/${REQUEST_ID}/cancel`)
      .expect(201)
      .expect({ status: 'cancelling' });

    expect(fake.cancelledRequestId).toBe(REQUEST_ID);
  });
});
