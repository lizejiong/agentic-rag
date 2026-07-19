import { DefaultChatTransport } from 'ai';

export function createChatTransport() {
  return new DefaultChatTransport({
    api: '/api/chat/stream',
    headers: () => ({
      'x-chat-protocol-version': '1',
      'x-trace-id': crypto.randomUUID(),
    }),
    prepareSendMessagesRequest: ({ id, messages }) => ({
      body: {
        id,
        requestId: crypto.randomUUID(),
        selectedSpaceIds: [],
        messages,
      },
    }),
  });
}
