import { BadRequestException, CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { z } from 'zod';

import type { AuthenticatedRequest } from '../auth/current-user.decorator';
import { AuthorizationService } from './authorization.service';
import type { SpacePermission } from './authorization.types';
import { REQUIRED_SPACE_PERMISSION } from './require-permission.decorator';

@Injectable()
export class SpacePermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authorization: AuthorizationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const permission = this.reflector.getAllAndOverride<SpacePermission>(
      REQUIRED_SPACE_PERMISSION,
      [context.getHandler(), context.getClass()],
    );
    if (!permission) {
      return true;
    }
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const parsed = z.uuid().safeParse(request.params['spaceId'] ?? request.params['id']);
    if (!parsed.success) {
      throw new BadRequestException('SPACE_ID_REQUIRED');
    }
    await this.authorization.requireSpace(request.user, parsed.data, permission);
    return true;
  }
}
