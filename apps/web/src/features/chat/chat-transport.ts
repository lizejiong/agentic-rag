import { DefaultChatTransport } from 'ai';

export function createChatTransport(options: {
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
    prepareSendMessagesRequest: ({ id, messages }) => ({
      body: {
        id,
        requestId: crypto.randomUUID(),
        selectedSpaceIds: options.getSelectedSpaceIds(),
        messages,
      },
    }),
  });
}
