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

const owner: AuthenticatedUser = { id: OWNER_ID, username: 'owner', role: 'MEMBER', tokenVersion: 0 };
const other: AuthenticatedUser = { id: OTHER_USER_ID, username: 'other', role: 'MEMBER', tokenVersion: 0 };
const citation: StoredCitation = {
  chunkId: '00000000-0000-4000-8000-000000000014', documentId: DOCUMENT_ID,
  title: '采购制度', snippet: '先提交采购申请。', location: { page: 1 },
};

function conversationRecord(overrides: Record<string, unknown> = {}) {
  return { id: CONVERSATION_ID, ownerId: OWNER_ID, title: '新会话', archivedAt: null, createdAt: new Date('2026-08-12T00:00:00Z'), updatedAt: new Date('2026-08-12T00:00:00Z'), ...overrides };
}

function turnRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: '00000000-0000-4000-8000-000000000015', conversationId: CONVERSATION_ID,
    requestId: REQUEST_ID, actorId: OWNER_ID, traceId: 'trace-1', question: '采购流程是什么？',
    scopeSpaceIds: [SPACE_ID], status: 'COMPLETED', answer: '先提交采购申请。', citations: [citation],
    errorCode: null, completedAt: new Date('2026-08-12T00:01:00Z'), createdAt: new Date('2026-08-12T00:00:00Z'), ...overrides,
  };
}

function createDependencies() {
  const transaction = {
    chatConversation: { findFirst: jest.fn().mockResolvedValue(conversationRecord()), findUniqueOrThrow: jest.fn().mockResolvedValue(conversationRecord()), update: jest.fn().mockResolvedValue(conversationRecord()) },
    chatTurn: { create: jest.fn().mockResolvedValue(turnRecord({ status: 'RUNNING', answer: null, citations: [] })), update: jest.fn().mockResolvedValue(turnRecord()) },
  };
  const prisma = {
    chatConversation: { findFirst: jest.fn().mockResolvedValue(conversationRecord()), findMany: jest.fn().mockResolvedValue([conversationRecord()]), create: jest.fn().mockResolvedValue(conversationRecord()), update: jest.fn().mockResolvedValue(conversationRecord()) },
    chatTurn: { findMany: jest.fn().mockResolvedValue([turnRecord()]), findUnique: jest.fn().mockResolvedValue(turnRecord()), update: jest.fn().mockResolvedValue(turnRecord()) },
    $transaction: jest.fn(async (operation: (tx: typeof transaction) => unknown) => operation(transaction)),
  };
  const authorization = { requireSpace: jest.fn().mockResolvedValue('VIEW'), authorizeDocument: jest.fn().mockResolvedValue({}) };
  const service = new ConversationService(prisma as unknown as PrismaService, authorization as unknown as AuthorizationService);
  return { prisma, transaction, authorization, service };
}

describe('ConversationService', () => {
  it('keeps another user from reading or archiving a conversation', async () => {
    const { prisma, service } = createDependencies();
    prisma.chatConversation.findFirst.mockResolvedValue(null);

    await expect(service.getConversation(other, CONVERSATION_ID)).rejects.toThrow('CHAT_CONVERSATION_NOT_FOUND');
    await expect(service.archiveConversation(other, CONVERSATION_ID)).rejects.toThrow('CHAT_CONVERSATION_NOT_FOUND');
  });

  it('stores only server-observed output when a turn completes', async () => {
    const { prisma, transaction, service } = createDependencies();
    await service.startTurn({ conversationId: CONVERSATION_ID, requestId: REQUEST_ID, actorId: OWNER_ID, question: '采购流程是什么？', scopeSpaceIds: [SPACE_ID], traceId: 'trace-1' });
    await service.completeTurn(REQUEST_ID, { answer: '先提交采购申请。', citations: [citation] });

    expect(transaction.chatTurn.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ question: '采购流程是什么？', citations: [], status: 'RUNNING' }) }));
    expect(prisma.chatTurn.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { requestId: REQUEST_ID },
      data: expect.objectContaining({ status: 'COMPLETED', answer: '先提交采购申请。', citations: [citation] }),
    }));
  });

  it('redacts a stored turn when current space access is no longer valid', async () => {
    const { authorization, service } = createDependencies();
    authorization.requireSpace.mockRejectedValue(new ForbiddenException('SPACE_PERMISSION_DENIED'));

    const detail = await service.getConversation(owner, CONVERSATION_ID);

    expect(detail.turns[0]).toEqual(expect.objectContaining({ visibility: 'REDACTED', question: null, answer: null, citations: [] }));
  });

  it('redacts a stored turn when a cited document is no longer readable', async () => {
    const { authorization, service } = createDependencies();
    authorization.authorizeDocument.mockRejectedValue(new NotFoundException('DOCUMENT_NOT_FOUND'));

    const detail = await service.getConversation(owner, CONVERSATION_ID);

    expect(detail.turns[0]).toEqual(expect.objectContaining({ visibility: 'REDACTED', question: null, answer: null }));
  });

  it('uses only the ten most recent visible completed turns as agent history', async () => {
    const { prisma, service } = createDependencies();
    prisma.chatTurn.findMany.mockResolvedValue(Array.from({ length: 12 }, (_, index) => turnRecord({ id: `00000000-0000-4000-8000-${String(index + 100).padStart(12, '0')}`, requestId: `00000000-0000-4000-8001-${String(index + 100).padStart(12, '0')}`, question: `问题 ${index}`, answer: `答案 ${index}`, citations: [] })));

    const history = await service.historyForRun(owner, CONVERSATION_ID);

    expect(history).toHaveLength(20);
    expect(history[0]).toEqual({ role: 'user', content: '问题 2' });
    expect(history.at(-1)).toEqual({ role: 'assistant', content: '答案 11' });
  });
});
