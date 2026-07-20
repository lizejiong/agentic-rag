import { request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { ExecutionContext, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AgentEvent, RunRequest } from '@rag/contracts';
import request from 'supertest';

import { AI_EVENT_SOURCE, type AiEventSource } from '../src/ai/ai-event-source';
import { AppModule } from '../src/app.module';
import { AccessTokenGuard } from '../src/auth/access-token.guard';
import type { AuthenticatedRequest } from '../src/auth/current-user.decorator';

const REQUEST_ID = '00000000-0000-4000-8000-000000000030';
const testAuthGuard = {
  canActivate(context: ExecutionContext): boolean {
    context.switchToHttp().getRequest<AuthenticatedRequest>().user = {
      id: '00000000-0000-4000-8000-000000000001',
      username: 'tester',
      role: 'MEMBER',
      tokenVersion: 0,
    };
    return true;
  },
};

function payload(requestId = REQUEST_ID) {
  return {
    id: 'e2e-conversation',
    requestId,
    selectedSpaceIds: [],
    messages: [
      {
        id: 'e2e-user',
        role: 'user',
        parts: [{ type: 'text', text: '验证取消传播' }],
      },
    ],
  };
}

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

class ObservableAiEventSource implements AiEventSource {
  lastSignal: AbortSignal | undefined;
  cancelledRequestId: string | undefined;
  runCount = 0;
  private started = deferred();
  private finished = deferred();

  waitUntilStarted(): Promise<void> {
    return this.started.promise;
  }

  waitUntilFinished(): Promise<void> {
    return this.finished.promise;
  }

  async *run(runRequest: RunRequest, signal: AbortSignal): AsyncIterable<AgentEvent> {
    this.runCount += 1;
    this.lastSignal = signal;
    this.started.resolve();
    const base = {
      requestId: runRequest.requestId,
      traceId: runRequest.traceId,
      occurredAt: '2026-07-18T00:00:00.000Z',
    } as const;

    try {
      yield { ...base, seq: 0, type: 'run.started' };
      if (this.runCount === 1) {
        while (!signal.aborted) {
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        yield {
          ...base,
          seq: 1,
          type: 'run.completed',
          finishReason: 'cancelled',
        };
      } else {
        yield {
          ...base,
          seq: 1,
          type: 'run.completed',
          finishReason: 'stop',
        };
      }
    } finally {
      this.finished.resolve();
    }
  }

  cancel(requestId: string): Promise<void> {
    this.cancelledRequestId = requestId;
    return Promise.resolve();
  }
}

describe('Chat cancellation boundaries', () => {
  let app: INestApplication;
  let fake: ObservableAiEventSource;

  beforeEach(async () => {
    fake = new ObservableAiEventSource();
    const module = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(AI_EVENT_SOURCE)
      .useValue(fake)
      .overrideGuard(AccessTokenGuard)
      .useValue(testAuthGuard)
      .compile();
    app = module.createNestApplication();
    await app.listen(0, '127.0.0.1');
  });

  afterEach(async () => {
    await app.close();
  });

  it('rejects unsupported protocol versions before starting AI', async () => {
    await request(app.getHttpServer() as Server)
      .post('/chat/stream')
      .set('x-chat-protocol-version', '0')
      .send(payload())
      .expect(409)
      .expect({
        statusCode: 409,
        code: 'CHAT_PROTOCOL_VERSION_UNSUPPORTED',
        supportedVersion: '1',
      });

    expect(fake.lastSignal).toBeUndefined();
  });

  it('aborts the active signal and calls upstream cancel explicitly', async () => {
    const streamResponse = request(app.getHttpServer() as Server)
      .post('/chat/stream')
      .set('x-chat-protocol-version', '1')
      .send(payload())
      .then((response) => response);
    await fake.waitUntilStarted();

    await request(app.getHttpServer() as Server)
      .post(`/chat/${REQUEST_ID}/cancel`)
      .expect(201)
      .expect({ status: 'cancelling' });

    expect(fake.lastSignal?.aborted).toBe(true);
    expect(fake.cancelledRequestId).toBe(REQUEST_ID);
    await expect(streamResponse).resolves.toHaveProperty('status', 200);
  });

  it('aborts on client disconnect and releases the request ID', async () => {
    const server = app.getHttpServer() as Server;
    const { port } = server.address() as AddressInfo;
    const body = JSON.stringify(payload());
    const clientRequest = httpRequest({
      host: '127.0.0.1',
      port,
      path: '/chat/stream',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
        'x-chat-protocol-version': '1',
      },
    });
    clientRequest.on('error', () => undefined);
    clientRequest.end(body);
    await fake.waitUntilStarted();

    clientRequest.destroy();
    await fake.waitUntilFinished();

    expect(fake.lastSignal?.aborted).toBe(true);
    await request(server)
      .post('/chat/stream')
      .set('x-chat-protocol-version', '1')
      .send(payload())
      .expect(200);
    expect(fake.runCount).toBe(2);
  });
});
