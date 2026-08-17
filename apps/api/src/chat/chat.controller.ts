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
import type { Response } from 'express';

import { AI_EVENT_SOURCE, type AiEventSource } from '../ai/ai-event-source';
import { AiStreamMapper } from '../ai/ai-stream.mapper';
import { AccessTokenGuard } from '../auth/access-token.guard';
import type { AuthenticatedRequest } from '../auth/current-user.decorator';
import { AuthorizationService } from '../authorization/authorization.service';
import type { AuthorizationSnapshot } from '../authorization/authorization.types';
import { ActiveRunRegistry } from './active-run.registry';
import { ChatProtocolGuard } from './chat-protocol.guard';
import { chatRequestSchema } from './chat.request';
import { ConversationService, type StoredCitation } from './conversation.service';

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
    private readonly conversations: ConversationService,
  ) {}

  @Post('stream')
  @UseGuards(AccessTokenGuard, ChatProtocolGuard)
  async stream(@Req() req: AuthenticatedRequest, @Res() res: Response): Promise<void> {
    const parsed = chatRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestException('INVALID_CHAT_REQUEST');
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
    const traceId = req.header('x-trace-id')?.trim() || randomUUID();
    await this.conversations.startTurn({
      conversationId: parsed.data.conversationId,
      requestId,
      actorId: req.user.id,
      question: parsed.data.message,
      scopeSpaceIds: parsed.data.selectedSpaceIds,
      traceId,
    });
    const context = await this.conversations.contextForRun(req.user, parsed.data.conversationId);
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
          const answerParts: string[] = [];
          const citations: StoredCitation[] = [];
          try {
            for await (const event of this.ai.run(
              {
                requestId,
                traceId,
                actorId: req.user.id,
                question: parsed.data.message,
                selectedSpaceIds: parsed.data.selectedSpaceIds,
                aclSnapshot: buildAclSnapshot(snapshot),
                sessionId: parsed.data.conversationId,
                history: context.history,
                historySummary: context.historySummary,
              },
              abort.signal,
            )) {
              if (event.type === 'text.delta') answerParts.push(event.text);
              if (event.type === 'citation') {
                citations.push({
                  chunkId: event.chunkId,
                  documentId: event.documentId,
                  title: event.title,
                  snippet: event.snippet,
                  location: event.location,
                });
              }
              if (event.type === 'run.completed' && event.finishReason === 'stop') {
                const turn = await this.conversations.completeTurn(requestId, {
                  answer: answerParts.join(''),
                  citations,
                });
                mapper.writeChatTurn(turn.id);
              } else if (event.type === 'run.completed') {
                await this.conversations.failTurn(requestId, 'CANCELLED', 'CHAT_CANCELLED');
              } else if (event.type === 'run.failed') {
                await this.conversations.failTurn(requestId, 'FAILED', event.code);
              }
              mapper.write(event);
            }
          } catch (error) {
            await this.conversations.failTurn(
              requestId,
              abort.signal.aborted ? 'CANCELLED' : 'FAILED',
              abort.signal.aborted ? 'CHAT_CANCELLED' : 'CHAT_STREAM_FAILED',
            );
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
    await this.conversations.getOwnedTurn(request.user, requestId);
    if (this.activeRuns.abort(requestId, request.user.id)) {
      await this.ai.cancel(requestId);
    }
    return { status: 'cancelling' };
  }
}
