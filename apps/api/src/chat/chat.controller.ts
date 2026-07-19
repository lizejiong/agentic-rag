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

@Controller('chat')
export class ChatController {
  constructor(
    @Inject(AI_EVENT_SOURCE) private readonly ai: AiEventSource,
    private readonly activeRuns: ActiveRunRegistry,
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
    const abort = this.activeRuns.start(requestId);
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
    @Param('requestId', new ParseUUIDPipe()) requestId: string,
  ): Promise<{ status: 'cancelling' }> {
    this.activeRuns.abort(requestId);
    await this.ai.cancel(requestId);
    return { status: 'cancelling' };
  }
}
