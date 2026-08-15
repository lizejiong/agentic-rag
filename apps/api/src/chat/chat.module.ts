import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { AI_EVENT_SOURCE } from '../ai/ai-event-source';
import { PythonAiClient } from '../ai/python-ai.client';
import { ActiveRunRegistry } from './active-run.registry';
import { ChatController } from './chat.controller';
import { ChatProtocolGuard } from './chat-protocol.guard';
import { ConversationController } from './conversation.controller';
import { ConversationService } from './conversation.service';

@Module({
  imports: [AuthModule],
  controllers: [ChatController, ConversationController],
  providers: [
    ActiveRunRegistry,
    ChatProtocolGuard,
    ConversationService,
    PythonAiClient,
    { provide: AI_EVENT_SOURCE, useExisting: PythonAiClient },
  ],
})
export class ChatModule {}
