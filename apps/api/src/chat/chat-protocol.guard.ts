import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';

export const CHAT_PROTOCOL_VERSION = '1';

@Injectable()
export class ChatProtocolGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (request.header('x-chat-protocol-version') !== CHAT_PROTOCOL_VERSION) {
      throw new HttpException(
        {
          statusCode: HttpStatus.CONFLICT,
          code: 'CHAT_PROTOCOL_VERSION_UNSUPPORTED',
          supportedVersion: CHAT_PROTOCOL_VERSION,
        },
        HttpStatus.CONFLICT,
      );
    }
    return true;
  }
}
