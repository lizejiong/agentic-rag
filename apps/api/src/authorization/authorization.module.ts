import { Global, Module } from '@nestjs/common';

import { AuthorizationController } from './authorization.controller';
import { AuthorizationRevisionService } from './authorization-revision.service';
import { AuthorizationService } from './authorization.service';
import { SpacePermissionGuard } from './space-permission.guard';

@Global()
@Module({
  controllers: [AuthorizationController],
  providers: [AuthorizationService, AuthorizationRevisionService, SpacePermissionGuard],
  exports: [AuthorizationService, AuthorizationRevisionService, SpacePermissionGuard],
})
export class AuthorizationModule {}
