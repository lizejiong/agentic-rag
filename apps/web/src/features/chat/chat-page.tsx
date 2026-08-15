import { useEffect, useMemo, useRef, useState } from 'react';

import { useChat } from '@ai-sdk/react';
import type { RagUIMessage } from '@rag/contracts';

import { useAuth } from '../auth/auth-provider';
import type { VisibleSpace } from '../spaces/space-contract';
import { useSpacesQuery } from '../spaces/use-spaces-query';
import { ChatComposer } from './chat-composer';
import { historyToMessages } from './chat-history-message';
import { createChatTransport } from './chat-transport';
import { ChatWorkspaceErrorBoundary } from './chat-workspace-error-boundary';
import { ConversationSidebar } from './conversation-sidebar';
import { ConversationView } from './conversation-view';
import { SpaceScopeSelector } from './space-scope-selector';
import {
  useChatConversation,
  useChatConversationActions,
  useChatConversations,
} from './use-chat-conversations';
import { useThrottledMessages } from './use-throttled-messages';

export function ChatPage() {
  const auth = useAuth();
  const spacesQuery = useSpacesQuery(auth.authorizedFetch);
  const conversations = useChatConversations(auth.authorizedFetch);
  const actions = useChatConversationActions(auth.authorizedFetch);
  const [activeConversationId, setActiveConversationId] = useState<string>();

  useEffect(() => {
    if (!activeConversationId && conversations.data?.conversations[0]) {
      setActiveConversationId(conversations.data.conversations[0].id);
    }
  }, [activeConversationId, conversations.data]);

  return (
    <main className="flex h-full min-h-0 bg-slate-50/40">
      <div className="flex h-full min-h-0 w-full overflow-hidden">
        <ConversationSidebar
          conversations={conversations.data?.conversations ?? []}
          activeId={activeConversationId}
          creating={actions.create.isPending}
          onCreate={() => actions.create.mutate(undefined, { onSuccess: (conversation) => setActiveConversationId(conversation.id) })}
          onSelect={setActiveConversationId}
          onRename={(conversationId, title) => actions.rename.mutate({ conversationId, title })}
          onArchive={(conversationId) => actions.archive.mutate(conversationId, { onSuccess: () => { if (activeConversationId === conversationId) setActiveConversationId(undefined); } })}
        />
        <ChatWorkspaceErrorBoundary>
          {activeConversationId ? <ChatSession key={activeConversationId} auth={auth} conversationId={activeConversationId} spaces={spacesQuery.data ?? []} spacesLoading={spacesQuery.isPending} spacesError={spacesQuery.isError} onCompleted={() => void actions.invalidate(activeConversationId)} /> : <section className="flex flex-1 items-center justify-center text-sm text-slate-500">新建会话后即可开始提问。</section>}
        </ChatWorkspaceErrorBoundary>
      </div>
    </main>
  );
}

function ChatSession({ auth, conversationId, spaces, spacesLoading, spacesError, onCompleted }: { auth: ReturnType<typeof useAuth>; conversationId: string; spaces: VisibleSpace[]; spacesLoading: boolean; spacesError: boolean; onCompleted: () => void }) {
  const detail = useChatConversation(auth.authorizedFetch, conversationId);
  if (detail.isPending) return <section className="flex flex-1 items-center justify-center text-sm text-slate-500">正在加载会话记录…</section>;
  if (!detail.data) return <section className="flex flex-1 items-center justify-center text-sm text-red-600">会话记录加载失败，请刷新页面后重试。</section>;
  return <ChatEngine auth={auth} conversationId={conversationId} initialMessages={historyToMessages(detail.data.turns)} spaces={spaces} spacesLoading={spacesLoading} spacesError={spacesError} onCompleted={onCompleted} />;
}

function ChatEngine({ auth, conversationId, initialMessages, spaces, spacesLoading, spacesError, onCompleted }: { auth: ReturnType<typeof useAuth>; conversationId: string; initialMessages: RagUIMessage[]; spaces: VisibleSpace[]; spacesLoading: boolean; spacesError: boolean; onCompleted: () => void }) {
  const [selectedSpaceIds, setSelectedSpaceIds] = useState<string[]>([]);
  const initialized = useRef(false);
  const selectedRef = useRef<string[]>([]);
  const [agentStatus, setAgentStatus] = useState<string>();
  selectedRef.current = selectedSpaceIds;
  useEffect(() => {
    if (!spaces.length) return;
    setSelectedSpaceIds((current) => {
      const visible = current.filter((id) => spaces.some((space) => space.id === id));
      if (!initialized.current) { initialized.current = true; return spaces.map((space) => space.id); }
      return visible;
    });
  }, [spaces]);
  const transport = useMemo(() => createChatTransport({ getAccessToken: auth.getAccessToken, getConversationId: () => conversationId, getSelectedSpaceIds: () => selectedRef.current, authorizedFetch: auth.authorizedFetch }), [auth.authorizedFetch, auth.getAccessToken, conversationId]);
  const { messages, setMessages, sendMessage, status, stop, error } = useChat<RagUIMessage>({ id: conversationId, transport, onData: (part) => { if (part.type === 'data-agent-status') setAgentStatus(part.data.status); }, onFinish: onCompleted });
  useEffect(() => { setMessages(initialMessages); }, [initialMessages, setMessages]);
  const displayedMessages = useThrottledMessages(messages);
  const busy = status === 'submitted' || status === 'streaming';
  return <section className="flex min-w-0 flex-1 flex-col" aria-label="知识问答对话"><ConversationView messages={displayedMessages} busy={busy} agentStatus={agentStatus} />
    <ChatComposer busy={busy} error={error} spaceError={spacesError ? '知识空间加载失败，请刷新页面后重试。' : undefined} spacesLoading={spacesLoading} hasSelectedSpaces={selectedSpaceIds.length > 0} onSend={(text) => { setAgentStatus(undefined); return sendMessage({ text }); }} onStop={stop} scopeControl={<SpaceScopeSelector spaces={spaces} selectedIds={selectedSpaceIds} loading={spacesLoading} onChange={setSelectedSpaceIds} />} />
  </section>;
}
