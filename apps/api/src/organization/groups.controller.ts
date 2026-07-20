import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';

import { AccessTokenGuard } from '../auth/access-token.guard';
import { AdminGuard } from '../auth/admin.guard';
import { OrganizationService } from './organization.service';
import { createSchema, parse, updateSchema } from './organization.validation';

@Controller('groups')
@UseGuards(AccessTokenGuard, AdminGuard)
export class GroupsController {
  constructor(private readonly organization: OrganizationService) {}

  @Get()
  list() {
    return this.organization.listGroups();
  }

  @Post()
  create(@Body() input: unknown) {
    return this.organization.createGroup(parse(createSchema, input));
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() input: unknown) {
    return this.organization.updateGroup(id, parse(updateSchema, input));
  }

  @Delete(':id')
  @HttpCode(204)
  delete(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.organization.deleteGroup(id);
  }

  @Put(':id/users/:userId')
  @HttpCode(204)
  addUser(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<void> {
    return this.organization.addGroupMember(id, userId);
  }

  @Delete(':id/users/:userId')
  @HttpCode(204)
  removeUser(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<void> {
    return this.organization.removeGroupMember(id, userId);
  }
}
