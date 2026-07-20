import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';

import { AccessTokenGuard } from '../auth/access-token.guard';
import { AdminGuard } from '../auth/admin.guard';
import { AuditService } from './audit.service';

const querySchema = z.object({
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

@Controller('audit-logs')
@UseGuards(AccessTokenGuard, AdminGuard)
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  list(@Query() query: unknown) {
    const parsed = querySchema.parse(query);
    return this.audit.list({
      limit: parsed.limit,
      ...(parsed.cursor ? { cursor: parsed.cursor } : {}),
    });
  }
}
