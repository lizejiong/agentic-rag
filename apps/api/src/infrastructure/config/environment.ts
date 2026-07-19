import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';

import { z } from 'zod';

const booleanValue = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

const environmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    DATABASE_URL: z.string().startsWith('postgresql://'),
    REDIS_URL: z.string().startsWith('redis://'),
    AI_SERVICE_URL: z.url().default('http://127.0.0.1:8001'),
    JWT_ACCESS_SECRET: z.string().min(32),
    JWT_REFRESH_PEPPER: z.string().min(32),
    COOKIE_SECURE: booleanValue,
  })
  .superRefine((environment, context) => {
    if (environment.JWT_ACCESS_SECRET === environment.JWT_REFRESH_PEPPER) {
      context.addIssue({
        code: 'custom',
        path: ['JWT_REFRESH_PEPPER'],
        message: 'JWT access secret and refresh pepper must be different.',
      });
    }

    if (
      environment.NODE_ENV === 'production' &&
      [
        environment.DATABASE_URL,
        environment.REDIS_URL,
        environment.JWT_ACCESS_SECRET,
        environment.JWT_REFRESH_PEPPER,
      ].some((value) => value.includes('change-me'))
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Production configuration cannot contain example secrets.',
      });
    }
  });

export type Environment = z.infer<typeof environmentSchema>;

export const ENVIRONMENT = Symbol('ENVIRONMENT');

export function loadWorkspaceEnvironment(): void {
  const candidates = [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      Object.assign(process.env, parseEnv(readFileSync(candidate, 'utf8')));
      return;
    }
  }
}

export function parseEnvironment(input: NodeJS.ProcessEnv = process.env): Environment {
  const result = environmentSchema.safeParse(input);

  if (!result.success) {
    throw new Error(z.prettifyError(result.error));
  }

  return result.data;
}
