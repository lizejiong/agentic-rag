import { z } from 'zod';

const eventBase = z.object({
  requestId: z.string().uuid(),
  traceId: z.string().min(1),
  seq: z.int().nonnegative(),
  occurredAt: z.string().datetime(),
}).strict();

const citationLocation = z.object({
  page: z.int().positive().optional(),
  slide: z.int().positive().optional(),
  sheet: z.string().min(1).optional(),
  cellRange: z.string().min(1).optional(),
}).strict();

export const agentEventSchema = z.discriminatedUnion('type', [
  eventBase.extend({ type: z.literal('run.started') }).strict(),
  eventBase.extend({
    type: z.literal('run.status'),
    status: z.enum(['understanding', 'retrieving', 'ranking', 'answering']),
  }).strict(),
  eventBase.extend({
    type: z.literal('text.delta'),
    text: z.string().min(1),
  }).strict(),
  eventBase.extend({
    type: z.literal('citation'),
    citationId: z.string().uuid(),
    title: z.string().min(1),
    snippet: z.string(),
    location: citationLocation,
  }).strict(),
  eventBase.extend({
    type: z.literal('run.completed'),
    finishReason: z.enum(['stop', 'cancelled']),
  }).strict(),
  eventBase.extend({
    type: z.literal('run.failed'),
    code: z.string().min(1),
    message: z.string().min(1),
    retryable: z.boolean(),
  }).strict(),
]);

export type AgentEvent = z.infer<typeof agentEventSchema>;

export const runRequestSchema = z.object({
  requestId: z.string().uuid(),
  traceId: z.string().min(1),
  actorId: z.string().min(1),
  question: z.string().trim().min(1).max(8000),
  selectedSpaceIds: z.array(z.string().uuid()).max(20),
}).strict();

export type RunRequest = z.infer<typeof runRequestSchema>;
