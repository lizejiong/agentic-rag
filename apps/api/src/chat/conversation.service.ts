import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import type { AuthenticatedUser } from '../auth/auth.types';
import { AuthorizationService } from '../authorization/authorization.service';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../infrastructure/database/prisma.service';

const DEFAULT_TITLE = '新会话';
const REDACTED_MESSAGE = '该轮记录因权限或文档状态变化不可显示';

export type StoredCitation = {
  chunkId: string;
  documentId: string;
  title: string;
  snippet: string;
  location: Record<string, unknown>;
};

type HistoryMessage = { role: 'user' | 'assistant'; content: string };

type StoredTurn = {
  id: string;
  requestId: string;
  question: string;
  scopeSpaceIds: string[];
  status: 'RUNNING' | 'COMPLETED' | 'CANCELLED' | 'FAILED';
  answer: string | null;
  citations: unknown;
  errorCode: string | null;
  completedAt: Date | null;
  createdAt: Date;
};

type VisibleTurn = {
  id: string;
  requestId: string;
  visibility: 'VISIBLE';
  question: string;
  scopeSpaceIds: string[];
  status: StoredTurn['status'];
  answer: string | null;
  citations: StoredCitation[];
  errorCode: string | null;
  completedAt: Date | null;
  createdAt: Date;
};

type RedactedTurn = {
  id: string;
  requestId: string;
  visibility: 'REDACTED';
  question: null;
  scopeSpaceIds: [];
  status: StoredTurn['status'];
  answer: null;
  citations: [];
  errorCode: null;
  completedAt: Date | null;
  createdAt: Date;
  message: typeof REDACTED_MESSAGE;
};

export type ConversationDetail = {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  turns: Array<VisibleTurn | RedactedTurn>;
};

function titleFromQuestion(question: string): string {
  const normalized = question.replaceAll(/\s+/g, ' ').trim();
  return Array.from(normalized).slice(0, 48).join('') || DEFAULT_TITLE;
}

function citationsFrom(value: unknown): StoredCitation[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is StoredCitation => {
    if (!item || typeof item !== 'object') return false;
    const citation = item as Record<string, unknown>;
    return ['chunkId', 'documentId', 'title', 'snippet'].every(
      (key) => typeof citation[key] === 'string',
    ) && typeof citation.location === 'object' && citation.location !== null;
  });
}

@Injectable()
export class ConversationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
  ) {}

  createConversation(user: AuthenticatedUser) {
    return this.prisma.chatConversation.create({
      data: { ownerId: user.id, title: DEFAULT_TITLE },
    });
  }

  async listConversations(user: AuthenticatedUser) {
    return this.prisma.chatConversation.findMany({
      where: { ownerId: user.id, archivedAt: null },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      select: { id: true, title: true, createdAt: true, updatedAt: true },
    });
  }

  async getConversation(user: AuthenticatedUser, conversationId: string): Promise<ConversationDetail> {
    const conversation = await this.requireOwnedActiveConversation(user.id, conversationId);
    const turns = await this.prisma.chatTurn.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true, requestId: true, question: true, scopeSpaceIds: true, status: true, answer: true,
        citations: true, errorCode: true, completedAt: true, createdAt: true,
      },
    });
    return {
      id: conversation.id,
      title: conversation.title,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      turns: await Promise.all(turns.map((turn) => this.visibleTurn(user, turn))),
    };
  }

  async renameConversation(user: AuthenticatedUser, conversationId: string, title: string) {
    await this.requireOwnedActiveConversation(user.id, conversationId);
    return this.prisma.chatConversation.update({ where: { id: conversationId }, data: { title } });
  }

  async archiveConversation(user: AuthenticatedUser, conversationId: string): Promise<void> {
    await this.requireOwnedActiveConversation(user.id, conversationId);
    await this.prisma.chatConversation.update({
      where: { id: conversationId },
      data: { archivedAt: new Date() },
    });
  }

  async startTurn(input: {
    conversationId: string;
    requestId: string;
    actorId: string;
    question: string;
    scopeSpaceIds: string[];
    traceId: string;
  }) {
    await this.requireOwnedActiveConversation(input.actorId, input.conversationId);
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const turn = await transaction.chatTurn.create({
          data: { ...input, citations: [], status: 'RUNNING' },
        });
        const conversation = await transaction.chatConversation.findUniqueOrThrow({
          where: { id: input.conversationId },
          select: { title: true },
        });
        if (conversation.title === DEFAULT_TITLE) {
          await transaction.chatConversation.update({
            where: { id: input.conversationId },
            data: { title: titleFromQuestion(input.question) },
          });
        }
        return turn;
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) throw new ConflictException('CHAT_TURN_ALREADY_EXISTS');
      throw error;
    }
  }

  completeTurn(requestId: string, output: { answer: string; citations: StoredCitation[] }) {
    return this.prisma.chatTurn.update({
      where: { requestId },
      data: {
        status: 'COMPLETED', answer: output.answer,
        citations: output.citations as Prisma.InputJsonValue,
        errorCode: null, completedAt: new Date(),
      },
    });
  }

  failTurn(requestId: string, status: 'CANCELLED' | 'FAILED', errorCode: string) {
    return this.prisma.chatTurn.update({
      where: { requestId },
      data: { status, errorCode, completedAt: new Date() },
    });
  }

  async historyForRun(user: AuthenticatedUser, conversationId: string): Promise<HistoryMessage[]> {
    const detail = await this.getConversation(user, conversationId);
    return detail.turns
      .filter((turn): turn is VisibleTurn => turn.visibility === 'VISIBLE' && turn.status === 'COMPLETED' && Boolean(turn.answer))
      .slice(-10)
      .flatMap((turn) => [
        { role: 'user' as const, content: turn.question },
        { role: 'assistant' as const, content: turn.answer! },
      ]);
  }

  async getOwnedTurn(user: AuthenticatedUser, requestId: string) {
    const turn = await this.prisma.chatTurn.findUnique({
      where: { requestId }, select: { id: true, conversation: { select: { ownerId: true, archivedAt: true } } },
    });
    if (!turn || turn.conversation.ownerId !== user.id || turn.conversation.archivedAt) {
      throw new NotFoundException('CHAT_TURN_NOT_FOUND');
    }
    return turn;
  }

  private async requireOwnedActiveConversation(ownerId: string, conversationId: string) {
    const conversation = await this.prisma.chatConversation.findFirst({
      where: { id: conversationId, ownerId, archivedAt: null },
      select: { id: true, title: true, createdAt: true, updatedAt: true },
    });
    if (!conversation) throw new NotFoundException('CHAT_CONVERSATION_NOT_FOUND');
    return conversation;
  }

  private async visibleTurn(user: AuthenticatedUser, turn: StoredTurn): Promise<VisibleTurn | RedactedTurn> {
    try {
      await Promise.all(turn.scopeSpaceIds.map((spaceId) => this.authorization.requireSpace(user, spaceId, 'VIEW')));
      const citations = citationsFrom(turn.citations);
      await Promise.all(citations.map((citation) => this.authorization.authorizeDocument(user, { documentId: citation.documentId, operation: 'CITATION' })));
      return { ...turn, visibility: 'VISIBLE', citations };
    } catch (error) {
      if (!(error instanceof ForbiddenException) && !(error instanceof NotFoundException)) throw error;
      return {
        id: turn.id, requestId: turn.requestId, visibility: 'REDACTED', question: null,
        scopeSpaceIds: [], status: turn.status, answer: null, citations: [], errorCode: null,
        completedAt: turn.completedAt, createdAt: turn.createdAt, message: REDACTED_MESSAGE,
      };
    }
  }

  private isUniqueViolation(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
  }
}
