import { z } from 'zod';

const messageSchema = z
  .object({
    id: z.string().min(1),
    role: z.enum(['user', 'assistant', 'system']),
    parts: z.array(z.unknown()),
  })
  .strict();

export const chatRequestSchema = z
  .object({
    id: z.string().min(1),
    requestId: z.string().uuid(),
    selectedSpaceIds: z.array(z.string().uuid()).max(20).default([]),
    messages: z.array(messageSchema).min(1),
  })
  .strict();

export type ChatRequest = z.infer<typeof chatRequestSchema>;
