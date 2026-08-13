import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { Fetcher } from '../../shared/api/request-json';
import {
  archiveChatConversation,
  createChatConversation,
  getChatConversation,
  listChatConversations,
  renameChatConversation,
} from './chat-api';

export const chatConversationsKey = ['chat-conversations'] as const;
export const chatConversationKey = (conversationId: string) => ['chat-conversation', conversationId] as const;

export function useChatConversations(fetcher: Fetcher) {
  return useQuery({ queryKey: chatConversationsKey, queryFn: ({ signal }) => listChatConversations(fetcher, signal) });
}

export function useChatConversation(fetcher: Fetcher, conversationId: string | undefined) {
  return useQuery({ queryKey: chatConversationKey(conversationId ?? ''), queryFn: ({ signal }) => getChatConversation(fetcher, conversationId!, signal), enabled: Boolean(conversationId) });
}

export function useChatConversationActions(fetcher: Fetcher) {
  const queryClient = useQueryClient();
  const invalidate = async (conversationId?: string) => {
    await queryClient.invalidateQueries({ queryKey: chatConversationsKey });
    if (conversationId) await queryClient.invalidateQueries({ queryKey: chatConversationKey(conversationId) });
  };
  const create = useMutation({ mutationFn: () => createChatConversation(fetcher), onSuccess: async (conversation) => invalidate(conversation.id) });
  const rename = useMutation({ mutationFn: ({ conversationId, title }: { conversationId: string; title: string }) => renameChatConversation(fetcher, conversationId, title), onSuccess: async (conversation) => invalidate(conversation.id) });
  const archive = useMutation({ mutationFn: (conversationId: string) => archiveChatConversation(fetcher, conversationId), onSuccess: async (_, conversationId) => {
    queryClient.removeQueries({ queryKey: chatConversationKey(conversationId) });
    await invalidate();
  } });
  return { create, rename, archive, invalidate };
}
