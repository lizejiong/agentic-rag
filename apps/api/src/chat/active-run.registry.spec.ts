import { ConflictException, ForbiddenException } from '@nestjs/common';

import { ActiveRunRegistry } from './active-run.registry';

describe('ActiveRunRegistry', () => {
  it('rejects a duplicate active request with a conflict', () => {
    const registry = new ActiveRunRegistry();
    registry.start('request-1', 'user-1');

    expect(() => registry.start('request-1', 'user-1')).toThrow(ConflictException);
    expect(() => registry.start('request-1', 'user-1')).toThrow('REQUEST_ALREADY_RUNNING');
  });

  it('allows idempotent abort and restart after finish', () => {
    const registry = new ActiveRunRegistry();
    const first = registry.start('request-1', 'user-1');

    registry.abort('request-1', 'user-1');
    registry.abort('request-1', 'user-1');
    expect(first.signal.aborted).toBe(true);

    registry.finish('request-1', first);
    expect(() => registry.start('request-1', 'user-1')).not.toThrow();
  });

  it('does not let a stale finish remove a replacement run', () => {
    const registry = new ActiveRunRegistry();
    const stale = registry.start('request-1', 'user-1');
    registry.finish('request-1', stale);
    const replacement = registry.start('request-1', 'user-1');

    registry.finish('request-1', stale);
    registry.abort('request-1', 'user-1');

    expect(replacement.signal.aborted).toBe(true);
  });

  it('does not let another user cancel an active run', () => {
    const registry = new ActiveRunRegistry();
    const active = registry.start('request-1', 'user-1');

    expect(() => registry.abort('request-1', 'user-2')).toThrow(ForbiddenException);
    expect(active.signal.aborted).toBe(false);
  });
});
