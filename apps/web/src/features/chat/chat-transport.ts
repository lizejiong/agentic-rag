import { DefaultChatTransport } from 'ai';

export function createChatTransport(options: {
  getConversationId: () => string | undefined;
  getAccessToken: () => string | undefined;
  getSelectedSpaceIds: () => string[];
  authorizedFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}) {
  return new DefaultChatTransport({
    api: '/api/chat/stream',
    fetch: options.authorizedFetch,
    headers: () => {
      const accessToken = options.getAccessToken();
      return {
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
        'x-chat-protocol-version': '1',
        'x-trace-id': crypto.randomUUID(),
      };
    },
    prepareSendMessagesRequest: ({ messages }) => {
      const conversationId = options.getConversationId();
      const lastMessage = messages.at(-1);
      const message = lastMessage?.role === 'user'
        ? lastMessage.parts.filter((part): part is { type: 'text'; text: string } => part.type === 'text').map((part) => part.text).join('').trim()
        : '';
      if (!conversationId || !message) throw new Error('CHAT_MESSAGE_REQUIRED');
      return { body: { conversationId, requestId: crypto.randomUUID(), selectedSpaceIds: options.getSelectedSpaceIds(), message } };
    },
  });
}
