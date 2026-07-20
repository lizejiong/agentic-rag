import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Observable } from 'rxjs';

import type { AuthenticatedRequest } from '../auth/current-user.decorator';
import { AuditContextService } from './audit-context.service';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly context: AuditContextService) {}

  intercept(executionContext: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = executionContext.switchToHttp().getRequest<AuthenticatedRequest>();
    const requestId = request.header('x-request-id')?.trim() || randomUUID();
    const traceId = request.header('x-trace-id')?.trim() || requestId;

    return new Observable((subscriber) =>
      this.context.run(
        {
          ...(request.user ? { actor: request.user } : {}),
          ...(request.ip ? { sourceIp: request.ip } : {}),
          requestId,
          traceId,
        },
        () => next.handle().subscribe(subscriber),
      ),
    );
  }
}
