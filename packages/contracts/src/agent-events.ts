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

const retrievalPathSummary = z.object({
  path: z.enum(['vector', 'lexical']),
  spaceId: z.string().min(1),
  candidatesReturned: z.int().nonnegative(),
  candidatesAfterAcl: z.int().nonnegative().optional(),
  error: z.string().optional(),
}).strict();

const retrievalSummary = z.object({
  query: z.string(),
  vectorTopK: z.int().nonnegative(),
  lexicalTopK: z.int().nonnegative(),
  rrfK: z.int().nonnegative(),
  rrfTopK: z.int().nonnegative(),
  rerankTopK: z.int().nonnegative(),
  rerankerEnabled: z.boolean(),
  rerankerFailed: z.boolean().optional(),
  paths: z.array(retrievalPathSummary),
  rrfCandidateCount: z.int().nonnegative(),
  finalCandidateCount: z.int().nonnegative(),
  embeddingModel: z.string(),
  embeddingVersion: z.string(),
  rerankerModel: z.string(),
  rerankerVersion: z.string(),
  elapsedMs: z.number().nonnegative(),
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
    chunkId: z.string().uuid(),
    documentId: z.string().uuid(),
    title: z.string().min(1),
    snippet: z.string(),
    location: citationLocation,
  }).strict(),
  eventBase.extend({
    type: z.literal('retrieval.summary'),
    summary: retrievalSummary,
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

export const chatHistoryMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1),
}).strict();

export const runRequestSchema = z.object({
  requestId: z.string().uuid(),
  traceId: z.string().min(1),
  actorId: z.string().min(1),
  question: z.string().trim().min(1).max(8000),
  selectedSpaceIds: z.array(z.string().uuid()).max(100),
  aclSnapshot: z.record(z.string(), z.unknown()).default({}),
  sessionId: z.string().max(120).optional(),
  history: z.array(chatHistoryMessageSchema).default([]),
}).strict();

export type RunRequest = z.infer<typeof runRequestSchema>;
export type ChatHistoryMessage = z.infer<typeof chatHistoryMessageSchema>;

export const chatRequestSchema = runRequestSchema.extend({
  history: z.array(chatHistoryMessageSchema).default([]),
}).strict();

export type ChatRequest = z.infer<typeof chatRequestSchema>;

export type CitationLocation = z.infer<typeof citationLocation>;
export type RetrievalSummary = z.infer<typeof retrievalSummary>;
export type RetrievalPathSummary = z.infer<typeof retrievalPathSummary>;
