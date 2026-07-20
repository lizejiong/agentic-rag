import {
  BadRequestException,
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';

import { AccessTokenGuard } from '../auth/access-token.guard';
import { AdminGuard } from '../auth/admin.guard';
import { UsersService } from './users.service';

const password = z.string().min(12).max(1024);
const createUserSchema = z.object({
  username: z.string().trim().min(1).max(80),
  displayName: z.string().trim().min(1).max(120),
  password,
  role: z.enum(['ADMIN', 'MEMBER']).default('MEMBER'),
});
const statusSchema = z.object({ status: z.enum(['ACTIVE', 'DISABLED']) });
const resetPasswordSchema = z.object({ password });

function parseInput<T>(schema: z.ZodType<T>, input: unknown, code: string): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new BadRequestException(code);
  }
  return parsed.data;
}

@Controller('users')
@UseGuards(AccessTokenGuard, AdminGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Post()
  create(@Body() input: unknown) {
    return this.users.create(parseInput(createUserSchema, input, 'INVALID_USER_REQUEST'));
  }

  @Patch(':id/status')
  setStatus(@Param('id', ParseUUIDPipe) id: string, @Body() input: unknown) {
    return this.users.setStatus(id, parseInput(statusSchema, input, 'INVALID_USER_STATUS').status);
  }

  @Post(':id/reset-password')
  async resetPassword(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: unknown,
  ): Promise<void> {
    await this.users.resetPassword(
      id,
      parseInput(resetPasswordSchema, input, 'INVALID_PASSWORD_RESET').password,
    );
  }
}
