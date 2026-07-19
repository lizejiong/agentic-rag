import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { AccessTokenGuard } from './access-token.guard';
import { AdminGuard } from './admin.guard';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';

@Global()
@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [AccessTokenGuard, AdminGuard, AuthService, PasswordService],
  exports: [JwtModule, AccessTokenGuard, AdminGuard, AuthService, PasswordService],
})
export class AuthModule {}
