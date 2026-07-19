import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { AI_EVENT_SOURCE } from '../ai/ai-event-source';
import { PythonAiClient } from '../ai/python-ai.client';
import { ActiveRunRegistry } from './active-run.registry';
import { ChatController } from './chat.controller';
import { ChatProtocolGuard } from './chat-protocol.guard';

@Module({
  imports: [AuthModule],
  controllers: [ChatController],
  providers: [
    ActiveRunRegistry,
    ChatProtocolGuard,
    PythonAiClient,
    { provide: AI_EVENT_SOURCE, useExisting: PythonAiClient },
  ],
})
export class ChatModule {}
