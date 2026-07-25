import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  Controller,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { RagUIMessage } from '@rag/contracts';
import type { Request, Response } from 'express';

import { AI_EVENT_SOURCE, type AiEventSource } from '../ai/ai-event-source';
import { AiStreamMapper } from '../ai/ai-stream.mapper';
import { AccessTokenGuard } from '../auth/access-token.guard';
import type { AuthenticatedRequest } from '../auth/current-user.decorator';
import { AuthorizationService } from '../authorization/authorization.service';
import type { AuthorizationSnapshot } from '../authorization/authorization.types';
import { ActiveRunRegistry } from './active-run.registry';
import { ChatProtocolGuard } from './chat-protocol.guard';
import { chatRequestSchema, type ChatRequest } from './chat.request';

function extractQuestion(messages: ChatRequest['messages']): string {
  const lastUser = [...messages].reverse().find((message) => message.role === 'user');
  if (!lastUser) {
    return '';
  }

  return lastUser.parts
    .filter(
      (part): part is { type: 'text'; text: string } =>
        typeof part === 'object' &&
        part !== null &&
        'type' in part &&
        part.type === 'text' &&
        'text' in part &&
        typeof part.text === 'string',
    )
    .map((part) => part.text)
    .join('')
    .trim();
}

function extractHistory(
  messages: ChatRequest['messages'],
  snapshot: AuthorizationSnapshot,
): Array<{ role: 'user' | 'assistant'; content: string }> {
  const history: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  for (const message of messages) {
    if (message.role !== 'user' && message.role !== 'assistant') {
      continue;
    }
    const text = message.parts
      .filter(
        (part): part is { type: 'text'; text: string } =>
          typeof part === 'object' &&
          part !== null &&
          'type' in part &&
          part.type === 'text' &&
          'text' in part &&
          typeof part.text === 'string',
      )
      .map((part) => part.text)
      .join('')
      .trim();
    if (!text) {
      continue;
    }
    history.push({ role: message.role, content: text });
  }
  // Exclude the last user message that is the current question.
  const last = history.at(-1);
  if (last?.role === 'user') {
    history.pop();
  }
  // Truncate to the most recent turns to stay within context budgets.
  return history.slice(-(snapshot.spaces ? 10 : 6));
}

function buildAclSnapshot(snapshot: AuthorizationSnapshot): Record<string, unknown> {
  return {
    userId: snapshot.userId,
    admin: snapshot.admin,
    departmentId: snapshot.departmentId,
    groupIds: snapshot.groupIds,
    spaces: snapshot.spaces,
  };
}

@Controller('chat')
export class ChatController {
  constructor(
    @Inject(AI_EVENT_SOURCE) private readonly ai: AiEventSource,
    private readonly activeRuns: ActiveRunRegistry,
    private readonly authorization: AuthorizationService,
  ) {}

  @Post('stream')
  @UseGuards(AccessTokenGuard, ChatProtocolGuard)
  async stream(@Req() req: AuthenticatedRequest, @Res() res: Response): Promise<void> {
    const parsed = chatRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestException('INVALID_CHAT_REQUEST');
    }

    const question = extractQuestion(parsed.data.messages);
    if (!question) {
      throw new BadRequestException('USER_QUESTION_REQUIRED');
    }

    const requestId = parsed.data.requestId;
    await Promise.all(
      parsed.data.selectedSpaceIds.map((spaceId) =>
        this.authorization.requireSpace(req.user, spaceId, 'VIEW'),
      ),
    );
    const snapshot =
      parsed.data.selectedSpaceIds.length > 0
        ? await this.authorization.snapshot(req.user)
        : ({
            userId: req.user.id,
            admin: req.user.role === 'ADMIN',
            groupIds: [],
            revision: 0n,
            spaces: {},
          } as AuthorizationSnapshot);
    const history = extractHistory(parsed.data.messages, snapshot);
    const abort = this.activeRuns.start(requestId, req.user.id);
    req.once('aborted', () => abort.abort());
    res.once('close', () => {
      if (!res.writableEnded) {
        abort.abort();
      }
    });

    try {
      const { createUIMessageStream, pipeUIMessageStreamToResponse } = await import('ai');
      const stream = createUIMessageStream<RagUIMessage>({
        execute: async ({ writer }) => {
          const mapper = new AiStreamMapper((chunk) => writer.write(chunk));
          try {
            for await (const event of this.ai.run(
              {
                requestId,
                traceId: req.header('x-trace-id')?.trim() || randomUUID(),
                actorId: req.user.id,
                question,
                selectedSpaceIds: parsed.data.selectedSpaceIds,
                aclSnapshot: buildAclSnapshot(snapshot),
                sessionId: parsed.data.id,
                history,
              },
              abort.signal,
            )) {
              mapper.write(event);
            }
          } catch (error) {
            if (!abort.signal.aborted) {
              throw error;
            }
          } finally {
            this.activeRuns.finish(requestId, abort);
          }
        },
        onError: () => 'AI stream failed',
      });

      pipeUIMessageStreamToResponse({ response: res, stream });
    } catch (error) {
      this.activeRuns.finish(requestId, abort);
      throw error;
    }
  }

  @Post(':requestId/cancel')
  @UseGuards(AccessTokenGuard)
  async cancel(
    @Req() request: AuthenticatedRequest,
    @Param('requestId', new ParseUUIDPipe()) requestId: string,
  ): Promise<{ status: 'cancelling' }> {
    if (this.activeRuns.abort(requestId, request.user.id)) {
      await this.ai.cancel(requestId);
    }
    return { status: 'cancelling' };
  }
}
