import { z } from 'zod';

import type { Fetcher } from '../../shared/api/request-json';
import { requestJson } from '../../shared/api/request-json';

const date = z.coerce.date();
const citation = z.object({
  chunkId: z.uuid(), documentId: z.uuid(), title: z.string(), snippet: z.string(),
  location: z.object({ page: z.number().int().positive().optional(), slide: z.number().int().positive().optional(), sheet: z.string().min(1).optional(), cellRange: z.string().min(1).optional() }),
});
const visibleTurn = z.object({
  id: z.uuid(), requestId: z.uuid(), visibility: z.literal('VISIBLE'), question: z.string(),
  scopeSpaceIds: z.array(z.uuid()), status: z.enum(['RUNNING', 'COMPLETED', 'CANCELLED', 'FAILED']),
  answer: z.string().nullable(), citations: z.array(citation), errorCode: z.string().nullable(),
  completedAt: date.nullable(), createdAt: date,
});
const redactedTurn = z.object({
  id: z.uuid(), requestId: z.uuid(), visibility: z.literal('REDACTED'), question: z.null(),
  scopeSpaceIds: z.array(z.never()), status: z.enum(['RUNNING', 'COMPLETED', 'CANCELLED', 'FAILED']),
  answer: z.null(), citations: z.array(z.never()), errorCode: z.null(), completedAt: date.nullable(), createdAt: date,
  message: z.string(),
});
const summary = z.object({ id: z.uuid(), title: z.string(), createdAt: date, updatedAt: date });

export type ConversationSummary = z.infer<typeof summary>;
export type PersistedChatTurn = z.infer<typeof visibleTurn> | z.infer<typeof redactedTurn>;
export type ConversationDetail = z.infer<typeof summary> & { turns: PersistedChatTurn[] };

const detail = summary.extend({ turns: z.array(z.union([visibleTurn, redactedTurn])) });

export function listChatConversations(fetcher: Fetcher, signal?: AbortSignal) {
  return requestJson({ schema: z.object({ conversations: z.array(summary), nextCursor: z.string().nullable() }), input: '/api/chat/conversations', init: signal ? { signal } : {}, fetcher });
}

export function getChatConversation(fetcher: Fetcher, conversationId: string, signal?: AbortSignal) {
  return requestJson({ schema: detail, input: `/api/chat/conversations/${conversationId}`, init: signal ? { signal } : {}, fetcher });
}

export function createChatConversation(fetcher: Fetcher) {
  return requestJson({ schema: summary, input: '/api/chat/conversations', init: { method: 'POST' }, fetcher });
}

export function renameChatConversation(fetcher: Fetcher, conversationId: string, title: string) {
  return requestJson({ schema: summary, input: `/api/chat/conversations/${conversationId}`, init: { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title }) }, fetcher });
}

export async function archiveChatConversation(fetcher: Fetcher, conversationId: string): Promise<void> {
  const response = await fetcher(`/api/chat/conversations/${conversationId}`, { method: 'DELETE' });
  if (!response.ok) throw new Error('CHAT_CONVERSATION_ARCHIVE_FAILED');
}
