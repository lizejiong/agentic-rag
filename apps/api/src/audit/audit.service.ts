import { Injectable } from '@nestjs/common';

import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { AuditContextService } from './audit-context.service';

const SENSITIVE_KEY = /(password|secret|token|authorization|cookie|credential|api[-_]?key)/i;

function sanitize(value: unknown): unknown {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || typeof value === 'string' || typeof value === 'number') {
    return value;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitize(item)).filter((item) => item !== undefined);
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !SENSITIVE_KEY.test(key))
        .map(([key, item]) => [key, sanitize(item)])
        .filter((entry) => entry[1] !== undefined),
    );
  }
  return undefined;
}

export type AuditWriteInput = {
  action: string;
  targetType: string;
  targetId?: string;
  result?: 'SUCCESS' | 'DENIED' | 'FAILED';
  reason?: string;
  metadata?: Record<string, unknown>;
};

@Injectable()
export class AuditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: AuditContextService,
  ) {}

  write(transaction: Prisma.TransactionClient, input: AuditWriteInput) {
    const context = this.context.get();
    return transaction.auditLog.create({
      data: {
        actorId: context?.actor?.id ?? null,
        actorUsername: context?.actor?.username ?? null,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId ?? null,
        result: input.result ?? 'SUCCESS',
        sourceIp: context?.sourceIp ?? null,
        requestId: context?.requestId ?? 'system',
        traceId: context?.traceId ?? 'system',
        reason: input.reason ?? null,
        metadata: input.metadata
          ? (sanitize(input.metadata) as Prisma.InputJsonValue)
          : Prisma.JsonNull,
      },
    });
  }

  list(input: { cursor?: string; limit: number }) {
    return this.prisma.auditLog.findMany({
      take: input.limit,
      ...(input.cursor ? { skip: 1, cursor: { id: input.cursor } } : {}),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }
}
