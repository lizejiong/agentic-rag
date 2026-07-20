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

@Controller('departments')
@UseGuards(AccessTokenGuard, AdminGuard)
export class DepartmentsController {
  constructor(private readonly organization: OrganizationService) {}

  @Get()
  list() {
    return this.organization.listDepartments();
  }

  @Post()
  create(@Body() input: unknown) {
    return this.organization.createDepartment(parse(createSchema, input));
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() input: unknown) {
    return this.organization.updateDepartment(id, parse(updateSchema, input));
  }

  @Delete(':id')
  @HttpCode(204)
  delete(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.organization.deleteDepartment(id);
  }

  @Put(':id/users/:userId')
  @HttpCode(204)
  assignUser(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<void> {
    return this.organization.assignDepartment(id, userId);
  }

  @Delete(':id/users/:userId')
  @HttpCode(204)
  removeUser(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<void> {
    return this.organization.removeDepartmentMember(id, userId);
  }
}
