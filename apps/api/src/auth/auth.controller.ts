import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { CookieOptions, Request, Response } from 'express';
import { z } from 'zod';

import { ENVIRONMENT, type Environment } from '../infrastructure/config/environment';
import { AccessTokenGuard } from './access-token.guard';
import { AuthService } from './auth.service';
import { CurrentUser } from './current-user.decorator';
import type { AuthenticatedUser } from './auth.types';
import { LoginRateLimiter } from './login-rate-limiter';
import {
  REFRESH_COOKIE_NAME,
  REFRESH_TOKEN_TTL_MS,
  RefreshTokenService,
} from './refresh-token.service';

const loginSchema = z.object({
  username: z.string().trim().min(1).max(80),
  password: z.string().min(1).max(1024),
});
const cookiesSchema = z.record(z.string(), z.string());

function requestMetadata(request: Request): { ip?: string; userAgent?: string } {
  const userAgent = request.header('user-agent');
  return {
    ...(request.ip ? { ip: request.ip } : {}),
    ...(userAgent ? { userAgent } : {}),
  };
}

function readRefreshToken(request: Request): string | undefined {
  const parsed = cookiesSchema.safeParse(request.cookies);
  return parsed.success ? parsed.data[REFRESH_COOKIE_NAME] : undefined;
}

@Controller('auth')
export class AuthController {
  private readonly refreshCookieOptions: CookieOptions;
  private readonly refreshCookieClearOptions: CookieOptions;

  constructor(
    private readonly auth: AuthService,
    private readonly refreshTokens: RefreshTokenService,
    private readonly loginRateLimiter: LoginRateLimiter,
    @Inject(ENVIRONMENT) environment: Environment,
  ) {
    this.refreshCookieOptions = {
      httpOnly: true,
      secure: environment.COOKIE_SECURE,
      sameSite: 'strict',
      path: '/auth',
      maxAge: REFRESH_TOKEN_TTL_MS,
    };
    this.refreshCookieClearOptions = {
      httpOnly: true,
      secure: environment.COOKIE_SECURE,
      sameSite: 'strict',
      path: '/auth',
    };
  }

  @Post('login')
  async login(
    @Body() input: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ accessToken: string; user: AuthenticatedUser }> {
    const parsed = loginSchema.safeParse(input);
    if (!parsed.success) {
      throw new BadRequestException('INVALID_LOGIN_REQUEST');
    }
    const credentials = parsed.data;
    const sourceIp = request.ip ?? 'unknown';
    await this.loginRateLimiter.consume(sourceIp, credentials.username);
    const result = await this.auth.login(credentials.username, credentials.password);
    await this.loginRateLimiter.reset(sourceIp, credentials.username);
    const refreshToken = await this.refreshTokens.create(result.user, requestMetadata(request));
    response.cookie(REFRESH_COOKIE_NAME, refreshToken, this.refreshCookieOptions);
    return result;
  }

  @Post('refresh')
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ accessToken: string; user: AuthenticatedUser }> {
    const refreshToken = readRefreshToken(request);
    if (!refreshToken) {
      throw new UnauthorizedException('REFRESH_TOKEN_REQUIRED');
    }
    const rotated = await this.refreshTokens.rotate(refreshToken, requestMetadata(request));
    response.cookie(REFRESH_COOKIE_NAME, rotated.refreshToken, this.refreshCookieOptions);
    return {
      accessToken: await this.auth.issueAccessToken(rotated.user),
      user: rotated.user,
    };
  }

  @Post('logout')
  @HttpCode(204)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.refreshTokens.logout(readRefreshToken(request));
    response.clearCookie(REFRESH_COOKIE_NAME, this.refreshCookieClearOptions);
  }

  @Post('logout-all')
  @HttpCode(204)
  @UseGuards(AccessTokenGuard)
  async logoutAll(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.refreshTokens.logoutAll(user.id);
    response.clearCookie(REFRESH_COOKIE_NAME, this.refreshCookieClearOptions);
  }

  @Get('me')
  @UseGuards(AccessTokenGuard)
  me(@CurrentUser() user: AuthenticatedUser): AuthenticatedUser {
    return user;
  }
}
