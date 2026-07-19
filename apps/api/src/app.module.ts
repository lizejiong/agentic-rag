import { Module } from '@nestjs/common';

import { ChatModule } from './chat/chat.module';
import { HealthController } from './health/health.controller';
import { ConfigurationModule } from './infrastructure/config/configuration.module';
import { DatabaseModule } from './infrastructure/database/database.module';

@Module({
  imports: [ConfigurationModule, DatabaseModule, ChatModule],
  controllers: [HealthController],
})
export class AppModule {}
