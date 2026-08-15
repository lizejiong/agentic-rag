import { z } from 'zod';

export const chatRequestSchema = z
  .object({
    conversationId: z.uuid(),
    requestId: z.string().uuid(),
    selectedSpaceIds: z.array(z.string().uuid()).min(1).max(100),
    message: z.string().trim().min(1).max(8_000),
  })
  .strict();

export type ChatRequest = z.infer<typeof chatRequestSchema>;
