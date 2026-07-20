import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { RedisModule } from '../infrastructure/redis/redis.module';
import { AccessTokenGuard } from './access-token.guard';
import { AdminGuard } from './admin.guard';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { LoginRateLimiter } from './login-rate-limiter';
import { RefreshTokenService } from './refresh-token.service';

@Global()
@Module({
  imports: [JwtModule.register({}), RedisModule],
  controllers: [AuthController],
  providers: [
    AccessTokenGuard,
    AdminGuard,
    AuthService,
    PasswordService,
    LoginRateLimiter,
    RefreshTokenService,
  ],
  exports: [
    JwtModule,
    AccessTokenGuard,
    AdminGuard,
    AuthService,
    PasswordService,
    LoginRateLimiter,
    RefreshTokenService,
  ],
})
export class AuthModule {}
