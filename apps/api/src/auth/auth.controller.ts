import { BadRequestException, Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';

import { AccessTokenGuard } from './access-token.guard';
import { AuthService } from './auth.service';
import { CurrentUser } from './current-user.decorator';
import type { AuthenticatedUser } from './auth.types';

const loginSchema = z.object({
  username: z.string().trim().min(1).max(80),
  password: z.string().min(1).max(1024),
});

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  login(@Body() input: unknown): Promise<{ accessToken: string; user: AuthenticatedUser }> {
    const parsed = loginSchema.safeParse(input);
    if (!parsed.success) {
      throw new BadRequestException('INVALID_LOGIN_REQUEST');
    }
    const credentials = parsed.data;
    return this.auth.login(credentials.username, credentials.password);
  }

  @Get('me')
  @UseGuards(AccessTokenGuard)
  me(@CurrentUser() user: AuthenticatedUser): AuthenticatedUser {
    return user;
  }
}
