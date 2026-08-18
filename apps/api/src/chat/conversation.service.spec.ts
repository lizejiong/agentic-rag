import { ForbiddenException, NotFoundException } from '@nestjs/common';

import type { AuthenticatedUser } from '../auth/auth.types';
import { AuthorizationService } from '../authorization/authorization.service';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { ConversationService, type StoredCitation } from './conversation.service';

const OWNER_ID = '00000000-0000-4000-8000-000000000001';
const OTHER_USER_ID = '00000000-0000-4000-8000-000000000002';
const CONVERSATION_ID = '00000000-0000-4000-8000-000000000010';
const REQUEST_ID = '00000000-0000-4000-8000-000000000011';
const SPACE_ID = '00000000-0000-4000-8000-000000000012';
const DOCUMENT_ID = '00000000-0000-4000-8000-000000000013';

type DocumentAuthorizationInput = { documentId: string };

const owner: AuthenticatedUser = {
  id: OWNER_ID,
  username: 'owner',
  role: 'MEMBER',
  tokenVersion: 0,
};
const other: AuthenticatedUser = {
  id: OTHER_USER_ID,
  username: 'other',
  role: 'MEMBER',
  tokenVersion: 0,
};
const citation: StoredCitation = {
  chunkId: '00000000-0000-4000-8000-000000000014',
  documentId: DOCUMENT_ID,
  title: '采购制度',
  snippet: '先提交采购申请。',
  location: { page: 1 },
};

function conversationRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: CONVERSATION_ID,
    ownerId: OWNER_ID,
    title: '新会话',
    archivedAt: null,
    createdAt: new Date('2026-08-12T00:00:00Z'),
    updatedAt: new Date('2026-08-12T00:00:00Z'),
    ...overrides,
  };
}

function turnRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: '00000000-0000-4000-8000-000000000015',
    conversationId: CONVERSATION_ID,
    requestId: REQUEST_ID,
    actorId: OWNER_ID,
    traceId: 'trace-1',
    question: '采购流程是什么？',
    scopeSpaceIds: [SPACE_ID],
    status: 'COMPLETED',
    answer: '先提交采购申请。',
    citations: [citation],
    errorCode: null,
    completedAt: new Date('2026-08-12T00:01:00Z'),
    createdAt: new Date('2026-08-12T00:00:00Z'),
    ...overrides,
  };
}

function createDependencies() {
  const transaction = {
    chatConversation: {
      findFirst: jest.fn().mockResolvedValue(conversationRecord()),
      findUniqueOrThrow: jest.fn().mockResolvedValue(conversationRecord()),
      update: jest.fn().mockResolvedValue(conversationRecord()),
    },
    chatTurn: {
      create: jest
        .fn()
        .mockResolvedValue(turnRecord({ status: 'RUNNING', answer: null, citations: [] })),
      update: jest.fn().mockResolvedValue(turnRecord()),
    },
  };
  const prisma = {
    chatConversation: {
      findFirst: jest.fn().mockResolvedValue(conversationRecord()),
      findMany: jest.fn().mockResolvedValue([conversationRecord()]),
      create: jest.fn().mockResolvedValue(conversationRecord()),
      update: jest.fn().mockResolvedValue(conversationRecord()),
    },
    chatTurn: {
      findMany: jest.fn().mockResolvedValue([turnRecord()]),
      findUnique: jest.fn().mockResolvedValue(turnRecord()),
      update: jest.fn().mockResolvedValue(turnRecord()),
    },
    $transaction: jest.fn((operation: (tx: typeof transaction) => unknown) =>
      Promise.resolve(operation(transaction)),
    ),
  };
  const authorization = {
    requireSpace: jest.fn().mockResolvedValue('VIEW'),
    authorizeDocument: jest.fn().mockResolvedValue({}),
  };
  const service = new ConversationService(
    prisma as unknown as PrismaService,
    authorization as unknown as AuthorizationService,
  );
  return { prisma, transaction, authorization, service };
}

describe('ConversationService', () => {
  it('keeps another user from reading or archiving a conversation', async () => {
    const { prisma, service } = createDependencies();
    prisma.chatConversation.findFirst.mockResolvedValue(null);

    await expect(service.getConversation(other, CONVERSATION_ID)).rejects.toThrow(
      'CHAT_CONVERSATION_NOT_FOUND',
    );
    await expect(service.archiveConversation(other, CONVERSATION_ID)).rejects.toThrow(
      'CHAT_CONVERSATION_NOT_FOUND',
    );
  });

  it('stores only server-observed output when a turn completes', async () => {
    const { prisma, transaction, service } = createDependencies();
    await service.startTurn({
      conversationId: CONVERSATION_ID,
      requestId: REQUEST_ID,
      actorId: OWNER_ID,
      question: '采购流程是什么？',
      scopeSpaceIds: [SPACE_ID],
      traceId: 'trace-1',
    });
    await service.completeTurn(REQUEST_ID, { answer: '先提交采购申请。', citations: [citation] });

    expect(transaction.chatTurn.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          question: '采购流程是什么？',
          citations: [],
          status: 'RUNNING',
        }) as unknown,
      }),
    );
    expect(prisma.chatTurn.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { requestId: REQUEST_ID },
        data: expect.objectContaining({
          status: 'COMPLETED',
          answer: '先提交采购申请。',
          citations: [citation],
        }) as unknown,
      }),
    );
  });

  it('redacts a stored turn when current space access is no longer valid', async () => {
    const { authorization, service } = createDependencies();
    authorization.requireSpace.mockRejectedValue(new ForbiddenException('SPACE_PERMISSION_DENIED'));

    const detail = await service.getConversation(owner, CONVERSATION_ID);

    expect(detail.turns[0]).toEqual(
      expect.objectContaining({
        visibility: 'REDACTED',
        question: null,
        answer: null,
        citations: [],
      }),
    );
  });

  it('redacts a stored turn when a cited document is no longer readable', async () => {
    const { authorization, service } = createDependencies();
    authorization.authorizeDocument.mockRejectedValue(new NotFoundException('DOCUMENT_NOT_FOUND'));

    const detail = await service.getConversation(owner, CONVERSATION_ID);

    expect(detail.turns[0]).toEqual(
      expect.objectContaining({ visibility: 'REDACTED', question: null, answer: null }),
    );
  });

  it('uses the six most recent visible completed turns as history and summarizes older questions', async () => {
    const { prisma, service } = createDependencies();
    prisma.chatTurn.findMany.mockResolvedValue(
      Array.from({ length: 12 }, (_, index) =>
        turnRecord({
          id: `00000000-0000-4000-8000-${String(index + 100).padStart(12, '0')}`,
          requestId: `00000000-0000-4000-8001-${String(index + 100).padStart(12, '0')}`,
          question: `问题 ${index}`,
          answer: `答案 ${index}`,
          citations: [],
        }),
      ),
    );

    const context = await service.contextForRun(owner, CONVERSATION_ID);

    expect(context.history).toHaveLength(12);
    expect(context.history[0]).toEqual({ role: 'user', content: '问题 6' });
    expect(context.history.at(-1)).toEqual({ role: 'assistant', content: '答案 11' });
    expect(context.historySummary).toBe(
      '此前已授权的用户话题：\n- 问题 0\n- 问题 1\n- 问题 2\n- 问题 3\n- 问题 4\n- 问题 5',
    );
    expect(context.historySummary).not.toContain('答案');
  });

  it('caps the summarized question count and character budgets while retaining recent turns', async () => {
    const { prisma, service } = createDependencies();
    prisma.chatTurn.findMany.mockResolvedValue(
      Array.from({ length: 30 }, (_, index) =>
        turnRecord({
          id: `00000000-0000-4000-8000-${String(index + 200).padStart(12, '0')}`,
          requestId: `00000000-0000-4000-8002-${String(index + 200).padStart(12, '0')}`,
          question: `  问题 ${index}\t${'x'.repeat(index === 4 ? 300 : 100)}  `,
          answer: `答案 ${index}`,
          citations: [],
        }),
      ),
    );

    const context = await service.contextForRun(owner, CONVERSATION_ID);

    expect(context.history).toHaveLength(12);
    expect(context.history[0]).toEqual({
      role: 'user',
      content: `  问题 24\t${'x'.repeat(100)}  `,
    });
    expect(context.history.at(-1)).toEqual({ role: 'assistant', content: '答案 29' });
    expect(context.historySummary).toMatch(/^此前已授权的用户话题：\n- /);
    expect(context.historySummary).not.toContain('问题 3 ');
    expect(context.historySummary).toContain('问题 4 ');
    expect(context.historySummary).toContain('问题 23 ');
    expect(context.historySummary.split('\n').filter((line) => line.startsWith('- '))).toHaveLength(
      20,
    );
    expect(context.historySummary.split('\n').every((line) => line.length <= 242)).toBe(true);
    expect(context.historySummary.length).toBeLessThanOrEqual(4000);
  });

  it('excludes currently redacted turns from both run context forms', async () => {
    const { authorization, prisma, service } = createDependencies();
    const revokedSpaceId = '00000000-0000-4000-8000-000000000016';
    const revokedDocumentId = '00000000-0000-4000-8000-000000000017';
    prisma.chatTurn.findMany.mockResolvedValue(
      Array.from({ length: 12 }, (_, index) =>
        turnRecord({
          id: `00000000-0000-4000-8000-${String(index + 300).padStart(12, '0')}`,
          requestId: `00000000-0000-4000-8003-${String(index + 300).padStart(12, '0')}`,
          question: `问题 ${index}`,
          answer: `答案 ${index}`,
          scopeSpaceIds: index === 4 ? [revokedSpaceId] : [SPACE_ID],
          citations: index === 8 ? [{ ...citation, documentId: revokedDocumentId }] : [],
        }),
      ),
    );
    authorization.requireSpace.mockImplementation((_user, spaceId) =>
      spaceId === revokedSpaceId
        ? Promise.reject(new ForbiddenException('SPACE_PERMISSION_DENIED'))
        : Promise.resolve('VIEW'),
    );
    authorization.authorizeDocument.mockImplementation(
      (_user, input: DocumentAuthorizationInput) =>
        input.documentId === revokedDocumentId
          ? Promise.reject(new NotFoundException('DOCUMENT_NOT_FOUND'))
          : Promise.resolve({}),
    );

    const context = await service.contextForRun(owner, CONVERSATION_ID);
    const detail = await service.getConversation(owner, CONVERSATION_ID);

    expect(context.history.map((message) => message.content)).not.toContain('问题 8');
    expect(context.historySummary).not.toContain('问题 4');
    expect(detail.turns.filter((turn) => turn.visibility === 'REDACTED')).toHaveLength(2);
  });
});
