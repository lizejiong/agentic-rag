import { MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import cookieParser from 'cookie-parser';

import { AuthModule } from './auth/auth.module';
import { AuditModule } from './audit/audit.module';
import { AuthorizationModule } from './authorization/authorization.module';
import { ChatModule } from './chat/chat.module';
import { DocumentsModule } from './documents/documents.module';
import { HealthController } from './health/health.controller';
import { ConfigurationModule } from './infrastructure/config/configuration.module';
import { DatabaseModule } from './infrastructure/database/database.module';
import { ObjectStorageModule } from './infrastructure/object-storage/object-storage.module';
import { OrganizationModule } from './organization/organization.module';
import { OutboxModule } from './outbox/outbox.module';
import { SpacesModule } from './spaces/spaces.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigurationModule,
    DatabaseModule,
    ObjectStorageModule,
    AuditModule,
    OutboxModule,
    AuthModule,
    AuthorizationModule,
    UsersModule,
    OrganizationModule,
    SpacesModule,
    DocumentsModule,
    ChatModule,
  ],
  controllers: [HealthController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(cookieParser()).forRoutes('*');
  }
}
