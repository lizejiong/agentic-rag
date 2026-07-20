import { SetMetadata } from '@nestjs/common';

export const AUDITED_ACTION = 'audit:action';

export const AuditedAction = (action: string) => SetMetadata(AUDITED_ACTION, action);
