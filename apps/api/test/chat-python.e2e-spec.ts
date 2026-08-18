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
import { AuthorizationService } from '../src/authorization/authorization.service';
import { ConversationService } from '../src/chat/conversation.service';

const REQUEST_ID = '00000000-0000-4000-8000-000000000030';
const CONVERSATION_ID = '00000000-0000-4000-8000-000000000031';
const TURN_ID = '00000000-0000-4000-8000-000000000032';
const SPACE_ID = '00000000-0000-4000-8000-000000000033';
const USER_ID = '00000000-0000-4000-8000-000000000001';
const testAuthGuard = {
  canActivate(context: ExecutionContext): boolean {
    context.switchToHttp().getRequest<AuthenticatedRequest>().user = {
      id: USER_ID,
      username: 'tester',
      role: 'MEMBER',
      tokenVersion: 0,
    };
    return true;
  },
};

function payload(requestId = REQUEST_ID) {
  return {
    conversationId: CONVERSATION_ID,
    requestId,
    selectedSpaceIds: [SPACE_ID],
    message: '验证取消传播',
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

async function waitForStreamStart(
  fake: ObservableAiEventSource,
  response: Promise<{ status: number; text: string }>,
): Promise<void> {
  const outcome = await Promise.race([
    fake.waitUntilStarted().then(() => ({ started: true as const })),
    response.then((result) => ({ started: false as const, result })),
  ]);
  if (!outcome.started) {
    throw new Error(
      `Expected the AI stream to start, received ${outcome.result.status}: ${outcome.result.text}`,
    );
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
      .overrideProvider(ConversationService)
      .useValue({
        startTurn: jest.fn().mockResolvedValue({ id: TURN_ID }),
        contextForRun: jest.fn().mockResolvedValue({ history: [], historySummary: '' }),
        completeTurn: jest.fn().mockResolvedValue({ id: TURN_ID }),
        failTurn: jest.fn().mockResolvedValue(undefined),
        getOwnedTurn: jest.fn().mockResolvedValue({ id: TURN_ID }),
      })
      .overrideProvider(AuthorizationService)
      .useValue({
        requireSpace: jest.fn().mockResolvedValue('VIEW'),
        snapshot: jest.fn().mockResolvedValue({
          userId: USER_ID,
          admin: false,
          groupIds: [],
          revision: 0n,
          spaces: { [SPACE_ID]: 'VIEW' },
        }),
      })
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
    await waitForStreamStart(fake, streamResponse);

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
