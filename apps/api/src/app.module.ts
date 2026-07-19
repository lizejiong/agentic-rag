import { Module } from '@nestjs/common';

import { ChatModule } from './chat/chat.module';
import { HealthController } from './health/health.controller';

@Module({
  imports: [ChatModule],
  controllers: [HealthController],
})
export class AppModule {}
