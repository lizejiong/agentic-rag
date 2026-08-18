import type { Server } from 'node:http';

import { ForbiddenException, type ExecutionContext, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AgentEvent } from '@rag/contracts';
import request from 'supertest';

import type { RunRequestInput } from '../ai/ai-event-source';
import { AI_EVENT_SOURCE, type AiEventSource } from '../ai/ai-event-source';
import { AccessTokenGuard } from '../auth/access-token.guard';
import type { AuthenticatedRequest } from '../auth/current-user.decorator';
import { AuthorizationService } from '../authorization/authorization.service';
import { ActiveRunRegistry } from './active-run.registry';
import { ChatController } from './chat.controller';
import { ConversationService } from './conversation.service';

const USER_ID = '00000000-0000-4000-8000-000000000001';
const REQUEST_ID = '00000000-0000-4000-8000-000000000010';
const CONVERSATION_ID = '00000000-0000-4000-8000-000000000020';
const SPACE_ID = '00000000-0000-4000-8000-000000000099';
const TURN_ID = '00000000-0000-4000-8000-000000000021';

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

class FakeAiEventSource implements AiEventSource {
  lastRequest: RunRequestInput | undefined;
  cancelledRequestId: string | undefined;

  async *run(runRequest: RunRequestInput): AsyncIterable<AgentEvent> {
    this.lastRequest = runRequest;
    await Promise.resolve();
    const base = {
      requestId: runRequest.requestId,
      traceId: runRequest.traceId,
      occurredAt: '2026-07-18T00:00:00.000Z',
    } as const;
    yield { ...base, seq: 0, type: 'run.started' };
    yield { ...base, seq: 1, type: 'text.delta', text: 'server answer' };
    yield {
      ...base,
      seq: 2,
      type: 'citation',
      citationId: '00000000-0000-4000-8000-000000000011',
      chunkId: '00000000-0000-4000-8000-000000000012',
      documentId: '00000000-0000-4000-8000-000000000013',
      title: 'document',
      snippet: 'evidence',
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
  let activeRuns: ActiveRunRegistry;
  let requireSpace: jest.Mock;
  let conversations: {
    startTurn: jest.Mock;
    contextForRun: jest.Mock;
    completeTurn: jest.Mock;
    failTurn: jest.Mock;
    getOwnedTurn: jest.Mock;
  };

  beforeEach(async () => {
    fake = new FakeAiEventSource();
    requireSpace = jest.fn().mockResolvedValue('VIEW');
    conversations = {
      startTurn: jest.fn().mockResolvedValue({ id: TURN_ID }),
      contextForRun: jest.fn().mockResolvedValue({
        history: [
          { role: 'user', content: 'trusted question' },
          { role: 'assistant', content: 'trusted answer' },
        ],
        historySummary: '此前已授权的用户话题：\n- trusted earlier question',
      }),
      completeTurn: jest.fn().mockResolvedValue({ id: TURN_ID }),
      failTurn: jest.fn().mockResolvedValue(undefined),
      getOwnedTurn: jest.fn().mockResolvedValue({ id: TURN_ID }),
    };
    const module = await Test.createTestingModule({
      controllers: [ChatController],
      providers: [
        ActiveRunRegistry,
        { provide: AI_EVENT_SOURCE, useValue: fake },
        { provide: ConversationService, useValue: conversations },
        {
          provide: AuthorizationService,
          useValue: {
            requireSpace,
            snapshot: jest.fn().mockResolvedValue({
              userId: USER_ID,
              admin: false,
              groupIds: [],
              spaces: { [SPACE_ID]: 'VIEW' },
            }),
          },
        },
      ],
    })
      .overrideGuard(AccessTokenGuard)
      .useValue(testAuthGuard)
      .compile();
    activeRuns = module.get(ActiveRunRegistry);
    app = module.createNestApplication();
    await app.init();
  });

  afterEach(async () => app.close());

  it('loads canonical history and persists only observed AI events', async () => {
    const response = await request(app.getHttpServer() as Server)
      .post('/chat/stream')
      .set('x-chat-protocol-version', '1')
      .set('x-trace-id', 'trace-fixed')
      .send({
        conversationId: CONVERSATION_ID,
        requestId: REQUEST_ID,
        selectedSpaceIds: [SPACE_ID],
        message: 'current question',
      })
      .expect(200);

    expect(response.headers['x-vercel-ai-ui-message-stream']).toBe('v1');
    expect(response.text).toContain('"type":"data-citation"');
    expect(response.text).toContain('"type":"data-chat-turn"');
    expect(fake.lastRequest).toEqual(
      expect.objectContaining({
        requestId: REQUEST_ID,
        traceId: 'trace-fixed',
        question: 'current question',
        history: [
          { role: 'user', content: 'trusted question' },
          { role: 'assistant', content: 'trusted answer' },
        ],
        historySummary: '此前已授权的用户话题：\n- trusted earlier question',
      }),
    );
    expect(conversations.contextForRun).toHaveBeenCalledWith(
      expect.objectContaining({ id: USER_ID }),
      CONVERSATION_ID,
    );
    expect(conversations.startTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: CONVERSATION_ID,
        question: 'current question',
        scopeSpaceIds: [SPACE_ID],
      }),
    );
    expect(conversations.completeTurn).toHaveBeenCalledWith(
      REQUEST_ID,
      expect.objectContaining({
        answer: 'server answer',
        citations: [
          expect.objectContaining({ documentId: '00000000-0000-4000-8000-000000000013' }),
        ],
      }),
    );
  });

  it('rejects an invalid stream body before starting AI', async () => {
    await request(app.getHttpServer() as Server)
      .post('/chat/stream')
      .set('x-chat-protocol-version', '1')
      .send({
        conversationId: CONVERSATION_ID,
        requestId: REQUEST_ID,
        selectedSpaceIds: [],
        message: ' ',
      })
      .expect(400);
    expect(fake.lastRequest).toBeUndefined();
    expect(conversations.startTurn).not.toHaveBeenCalled();
  });

  it('rejects a selected space before creating a turn when the user lacks VIEW', async () => {
    requireSpace.mockRejectedValue(new ForbiddenException('SPACE_PERMISSION_DENIED'));
    await request(app.getHttpServer() as Server)
      .post('/chat/stream')
      .set('x-chat-protocol-version', '1')
      .send({
        conversationId: CONVERSATION_ID,
        requestId: REQUEST_ID,
        selectedSpaceIds: [SPACE_ID],
        message: 'question',
      })
      .expect(403);
    expect(conversations.startTurn).not.toHaveBeenCalled();
  });

  it('requires turn ownership before forwarding explicit cancellation', async () => {
    activeRuns.start(REQUEST_ID, USER_ID);
    await request(app.getHttpServer() as Server)
      .post(`/chat/${REQUEST_ID}/cancel`)
      .expect(201)
      .expect({ status: 'cancelling' });
    expect(conversations.getOwnedTurn).toHaveBeenCalledWith(
      expect.objectContaining({ id: USER_ID }),
      REQUEST_ID,
    );
    expect(fake.cancelledRequestId).toBe(REQUEST_ID);
  });
});
