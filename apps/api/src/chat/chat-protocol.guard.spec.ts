import { type ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';

import { CHAT_PROTOCOL_VERSION, ChatProtocolGuard } from './chat-protocol.guard';

function contextWithVersion(version: string | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        header: (name: string) => (name === 'x-chat-protocol-version' ? version : undefined),
      }),
    }),
  } as unknown as ExecutionContext;
}

describe('ChatProtocolGuard', () => {
  const guard = new ChatProtocolGuard();

  it('accepts the supported version', () => {
    expect(guard.canActivate(contextWithVersion(CHAT_PROTOCOL_VERSION))).toBe(true);
  });

  it('rejects a missing or unsupported version with the exact contract', () => {
    for (const version of [undefined, '0', '2']) {
      try {
        guard.canActivate(contextWithVersion(version));
        throw new Error('Expected protocol rejection');
      } catch (error) {
        expect(error).toBeInstanceOf(HttpException);
        const exception = error as HttpException;
        expect(exception.getStatus()).toBe(HttpStatus.CONFLICT);
        expect(exception.getResponse()).toEqual({
          statusCode: 409,
          code: 'CHAT_PROTOCOL_VERSION_UNSUPPORTED',
          supportedVersion: '1',
        });
      }
    }
  });
});
