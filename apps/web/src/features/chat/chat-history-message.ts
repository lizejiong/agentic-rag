import type { RagUIMessage } from '@rag/contracts';

import type { PersistedChatTurn } from './chat-api';

function id(prefix: string, value: string) { return `${prefix}-${value}`; }

export function turnToMessages(turn: PersistedChatTurn): RagUIMessage[] {
  if (turn.visibility === 'REDACTED') {
    return [{ id: id('redacted', turn.id), role: 'system', parts: [{ type: 'text', text: turn.message }] }];
  }
  const user: RagUIMessage = { id: id('user', turn.id), role: 'user', parts: [{ type: 'text', text: turn.question }] };
  if (turn.status !== 'COMPLETED') {
    const text = turn.status === 'CANCELLED' ? '该次回答已取消。' : turn.status === 'FAILED' ? '该次回答未能完成。' : '该次回答仍在处理中。';
    return [user, { id: id('status', turn.id), role: 'assistant', parts: [{ type: 'text', text }] }];
  }
  const parts: RagUIMessage['parts'] = [
    ...(turn.answer ? [{ type: 'text' as const, text: turn.answer }] : []),
    ...turn.citations.map((citation) => ({ type: 'data-citation' as const, id: citation.chunkId, data: { citationId: citation.chunkId, ...citation } })),
    { type: 'data-chat-turn' as const, id: id('turn', turn.id), data: { turnId: turn.id } },
  ];
  return [user, { id: id('assistant', turn.id), role: 'assistant', parts }];
}

export function historyToMessages(turns: PersistedChatTurn[]): RagUIMessage[] {
  return turns.flatMap(turnToMessages);
}
