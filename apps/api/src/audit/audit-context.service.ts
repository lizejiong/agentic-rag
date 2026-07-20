import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';

import type { AuthenticatedUser } from '../auth/auth.types';

export type AuditRequestContext = {
  actor?: AuthenticatedUser;
  sourceIp?: string;
  requestId: string;
  traceId: string;
};

@Injectable()
export class AuditContextService {
  private readonly storage = new AsyncLocalStorage<AuditRequestContext>();

  run<T>(context: AuditRequestContext, operation: () => T): T {
    return this.storage.run(context, operation);
  }

  get(): AuditRequestContext | undefined {
    return this.storage.getStore();
  }
}
