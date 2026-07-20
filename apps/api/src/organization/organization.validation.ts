import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

export const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2_000).optional(),
});

export const updateSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(2_000).nullable().optional(),
  })
  .refine((input) => Object.keys(input).length > 0);

export function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new BadRequestException('INVALID_ORGANIZATION_REQUEST');
  }
  return result.data;
}
