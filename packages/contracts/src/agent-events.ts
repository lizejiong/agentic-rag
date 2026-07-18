import { z } from 'zod';

const eventBase = z.object({
  requestId: z.string().uuid(),
  traceId: z.string().min(1),
  seq: z.int().nonnegative(),
  occurredAt: z.string().datetime(),
});

const citationLocation = z.object({
  page: z.int().positive().optional(),
  slide: z.int().positive().optional(),
  sheet: z.string().min(1).optional(),
  cellRange: z.string().min(1).optional(),
});

export const agentEventSchema = z.discriminatedUnion('type', [
  eventBase.extend({ type: z.literal('run.started') }),
  eventBase.extend({
    type: z.literal('run.status'),
    status: z.enum(['understanding', 'retrieving', 'ranking', 'answering']),
  }),
  eventBase.extend({
    type: z.literal('text.delta'),
    text: z.string().min(1),
  }),
  eventBase.extend({
    type: z.literal('citation'),
    citationId: z.string().uuid(),
    title: z.string().min(1),
    snippet: z.string(),
    location: citationLocation,
  }),
  eventBase.extend({
    type: z.literal('run.completed'),
    finishReason: z.enum(['stop', 'cancelled']),
  }),
  eventBase.extend({
    type: z.literal('run.failed'),
    code: z.string().min(1),
    message: z.string().min(1),
    retryable: z.boolean(),
  }),
]);

export type AgentEvent = z.infer<typeof agentEventSchema>;

export const runRequestSchema = z.object({
  requestId: z.string().uuid(),
  traceId: z.string().min(1),
  actorId: z.string().min(1),
  question: z.string().trim().min(1).max(8000),
  selectedSpaceIds: z.array(z.string().uuid()).max(20),
});

export type RunRequest = z.infer<typeof runRequestSchema>;
