import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';

import { AccessTokenGuard } from '../auth/access-token.guard';
import { CurrentUser, type AuthenticatedRequest } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { RequireSpacePermission } from '../authorization/require-permission.decorator';
import { SpacePermissionGuard } from '../authorization/space-permission.guard';
import { DocumentImportService } from './document-import.service';
import { parseCreateFileImports, parseCreateUrlImport } from './document-import.validation';

@Controller()
@UseGuards(AccessTokenGuard)
export class DocumentImportController {
  constructor(private readonly imports: DocumentImportService) {}

  @Post('spaces/:spaceId/imports/files')
  @UseGuards(SpacePermissionGuard)
  @RequireSpacePermission('EDIT')
  createFiles(
    @CurrentUser() user: AuthenticatedUser,
    @Param('spaceId', ParseUUIDPipe) spaceId: string,
    @Body() input: unknown,
  ) {
    return this.imports.createFileImports(user, spaceId, parseCreateFileImports(input));
  }

  @Post('spaces/:spaceId/imports/urls')
  @UseGuards(SpacePermissionGuard)
  @RequireSpacePermission('EDIT')
  createUrl(
    @CurrentUser() user: AuthenticatedUser,
    @Param('spaceId', ParseUUIDPipe) spaceId: string,
    @Body() input: unknown,
  ) {
    return this.imports.createUrlImport(user, spaceId, parseCreateUrlImport(input));
  }

  @Post('documents/:documentId/refresh-url')
  refreshUrl(
    @CurrentUser() user: AuthenticatedUser,
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ) {
    return this.imports.refreshUrl(user, documentId);
  }

  @Put('imports/:importId/content')
  upload(
    @CurrentUser() user: AuthenticatedUser,
    @Param('importId', ParseUUIDPipe) importId: string,
    @Req() request: AuthenticatedRequest,
    @Headers('content-length') contentLength: string | undefined,
    @Headers('content-type') contentType: string | undefined,
  ) {
    const parsedLength = Number(contentLength);
    if (!contentLength || !Number.isSafeInteger(parsedLength) || parsedLength <= 0) {
      throw new BadRequestException('CONTENT_LENGTH_REQUIRED');
    }
    return this.imports.uploadContent({
      user,
      importId,
      source: request,
      contentLength: parsedLength,
      contentType: contentType?.trim() || 'application/octet-stream',
    });
  }

  @Get('imports/:importId')
  getTask(
    @CurrentUser() user: AuthenticatedUser,
    @Param('importId', ParseUUIDPipe) importId: string,
  ) {
    return this.imports.getTask(user, importId);
  }

  @Post('imports/:importId/cancel')
  @HttpCode(200)
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('importId', ParseUUIDPipe) importId: string,
  ) {
    return this.imports.cancel(user, importId);
  }
}
