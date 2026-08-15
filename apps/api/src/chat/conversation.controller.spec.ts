import type { Server } from 'node:http';

import type { ExecutionContext, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AccessTokenGuard } from '../auth/access-token.guard';
import type { AuthenticatedRequest } from '../auth/current-user.decorator';
import { ConversationController } from './conversation.controller';
import { ConversationService } from './conversation.service';

const OWNER_ID = '00000000-0000-4000-8000-000000000001';
const CONVERSATION_ID = '00000000-0000-4000-8000-000000000010';
const user = { id: OWNER_ID, username: 'owner', role: 'MEMBER' as const, tokenVersion: 0 };
const conversation = {
  id: CONVERSATION_ID,
  title: '采购制度',
  createdAt: new Date('2026-08-12T00:00:00Z'),
  updatedAt: new Date('2026-08-12T00:00:00Z'),
};

const testAuthGuard = {
  canActivate(context: ExecutionContext): boolean {
    context.switchToHttp().getRequest<AuthenticatedRequest>().user = user;
    return true;
  },
};

describe('ConversationController', () => {
  let app: INestApplication;
  let service: {
    listConversations: jest.Mock;
    createConversation: jest.Mock;
    getConversation: jest.Mock;
    renameConversation: jest.Mock;
    archiveConversation: jest.Mock;
  };

  beforeEach(async () => {
    service = {
      listConversations: jest.fn().mockResolvedValue([conversation]),
      createConversation: jest.fn().mockResolvedValue(conversation),
      getConversation: jest.fn().mockResolvedValue({ ...conversation, turns: [] }),
      renameConversation: jest.fn().mockResolvedValue({ ...conversation, title: '新标题' }),
      archiveConversation: jest.fn().mockResolvedValue(undefined),
    };
    const module = await Test.createTestingModule({
      controllers: [ConversationController],
      providers: [{ provide: ConversationService, useValue: service }],
    })
      .overrideGuard(AccessTokenGuard)
      .useValue(testAuthGuard)
      .compile();
    app = module.createNestApplication();
    await app.init();
  });

  afterEach(async () => app.close());

  it("lists only the current user's active conversations", async () => {
    const response = await request(app.getHttpServer() as Server)
      .get('/chat/conversations')
      .expect(200);
    const body = response.body as { conversations: Array<{ id: string; title: string }> };
    expect(body.conversations).toHaveLength(1);
    expect(body.conversations[0]).toEqual(
      expect.objectContaining({ id: CONVERSATION_ID, title: '采购制度' }),
    );
    expect(service.listConversations).toHaveBeenCalledWith(user);
  });

  it('creates a conversation and validates titles before update', async () => {
    await request(app.getHttpServer() as Server)
      .post('/chat/conversations')
      .expect(201);
    await request(app.getHttpServer() as Server)
      .patch(`/chat/conversations/${CONVERSATION_ID}`)
      .send({ title: '   ' })
      .expect(400);
    await request(app.getHttpServer() as Server)
      .patch(`/chat/conversations/${CONVERSATION_ID}`)
      .send({ title: ' 新标题 ' })
      .expect(200);
    expect(service.createConversation).toHaveBeenCalledWith(user);
    expect(service.renameConversation).toHaveBeenCalledWith(user, CONVERSATION_ID, '新标题');
  });

  it("returns the detail and archives only the owner's conversation", async () => {
    await request(app.getHttpServer() as Server)
      .get(`/chat/conversations/${CONVERSATION_ID}`)
      .expect(200);
    await request(app.getHttpServer() as Server)
      .delete(`/chat/conversations/${CONVERSATION_ID}`)
      .expect(204);
    expect(service.getConversation).toHaveBeenCalledWith(user, CONVERSATION_ID);
    expect(service.archiveConversation).toHaveBeenCalledWith(user, CONVERSATION_ID);
  });
});
