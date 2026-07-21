import { Controller, Get, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';

import { AccessTokenGuard } from '../auth/access-token.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { RequireSpacePermission } from '../authorization/require-permission.decorator';
import { SpacePermissionGuard } from '../authorization/space-permission.guard';
import { DocumentsService } from './documents.service';

@Controller()
@UseGuards(AccessTokenGuard)
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get('spaces/:spaceId/documents')
  @UseGuards(SpacePermissionGuard)
  @RequireSpacePermission('VIEW')
  list(@Param('spaceId', ParseUUIDPipe) spaceId: string) {
    return this.documents.list(spaceId);
  }

  @Get('documents/:documentId')
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ) {
    return this.documents.get(user, documentId);
  }
}
