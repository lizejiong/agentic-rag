import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';

import { AccessTokenGuard } from '../auth/access-token.guard';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { ConversationService } from './conversation.service';

const titleSchema = z.object({ title: z.string().trim().min(1).max(120) }).strict();

function parseTitle(input: unknown): string {
  const parsed = titleSchema.safeParse(input);
  if (!parsed.success) throw new BadRequestException('INVALID_CHAT_CONVERSATION_REQUEST');
  return parsed.data.title;
}

@Controller('chat/conversations')
@UseGuards(AccessTokenGuard)
export class ConversationController {
  constructor(private readonly conversations: ConversationService) {}

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser) {
    return { conversations: await this.conversations.listConversations(user), nextCursor: null };
  }

  @Post()
  create(@CurrentUser() user: AuthenticatedUser) {
    return this.conversations.createConversation(user);
  }

  @Get(':conversationId')
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('conversationId', new ParseUUIDPipe()) conversationId: string,
  ) {
    return this.conversations.getConversation(user, conversationId);
  }

  @Patch(':conversationId')
  rename(
    @CurrentUser() user: AuthenticatedUser,
    @Param('conversationId', new ParseUUIDPipe()) conversationId: string,
    @Body() input: unknown,
  ) {
    return this.conversations.renameConversation(user, conversationId, parseTitle(input));
  }

  @Delete(':conversationId')
  @HttpCode(204)
  async archive(
    @CurrentUser() user: AuthenticatedUser,
    @Param('conversationId', new ParseUUIDPipe()) conversationId: string,
  ): Promise<void> {
    await this.conversations.archiveConversation(user, conversationId);
  }
}
