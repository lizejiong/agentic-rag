import { Module } from '@nestjs/common';

import { AuthModule } from './auth/auth.module';
import { ChatModule } from './chat/chat.module';
import { HealthController } from './health/health.controller';
import { ConfigurationModule } from './infrastructure/config/configuration.module';
import { DatabaseModule } from './infrastructure/database/database.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [ConfigurationModule, DatabaseModule, AuthModule, UsersModule, ChatModule],
  controllers: [HealthController],
})
export class AppModule {}
