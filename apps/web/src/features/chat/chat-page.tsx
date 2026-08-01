import { useEffect, useMemo, useRef, useState } from 'react';

import { useChat } from '@ai-sdk/react';
import type { RagUIMessage } from '@rag/contracts';
import { Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';

import { useAuth } from '../auth/auth-provider';
import type { VisibleSpace } from '../spaces/space-contract';
import { useSpacesQuery } from '../spaces/use-spaces-query';
import { ChatComposer } from './chat-composer';
import { createChatTransport } from './chat-transport';
import { ChatWorkspaceErrorBoundary } from './chat-workspace-error-boundary';
import { ConversationView } from './conversation-view';
import { SpaceScopeSelector } from './space-scope-selector';
import { useThrottledMessages } from './use-throttled-messages';

type BrowserConversation = {
  id: string;
  label: string;
};

export function ChatPage() {
  const auth = useAuth();
  const spacesQuery = useSpacesQuery(auth.authorizedFetch);
  const spaces = spacesQuery.data ?? [];
  const [selectedSpaceIds, setSelectedSpaceIds] = useState<string[]>([]);
  const hasInitializedSpaces = useRef(false);
  const [conversations, setConversations] = useState<BrowserConversation[]>([
    { id: crypto.randomUUID(), label: '当前对话 1' },
  ]);
  const [activeConversationId, setActiveConversationId] = useState(
    () => conversations[0]?.id ?? '',
  );

  const createConversation = () => {
    const nextConversation = {
      id: crypto.randomUUID(),
      label: `当前对话 ${conversations.length + 1}`,
    };
    setConversations((current) => [...current, nextConversation]);
    setActiveConversationId(nextConversation.id);
  };

  useEffect(() => {
    if (!spacesQuery.data) return;

    setSelectedSpaceIds((current) => {
      const stillVisible = current.filter((id) =>
        spacesQuery.data.some((space) => space.id === id),
      );
      if (!hasInitializedSpaces.current) {
        hasInitializedSpaces.current = true;
        return spacesQuery.data.map((space) => space.id);
      }
      return stillVisible;
    });
  }, [spacesQuery.data]);

  return (
    <main className="flex h-full min-h-0 bg-slate-50/40">
      <div className="flex h-full min-h-0 w-full overflow-hidden">
        <aside className="flex w-60 shrink-0 flex-col border-r border-slate-200 bg-slate-50/70 p-3">
          <div className="px-2 pb-3">
            <p className="text-sm font-semibold text-slate-900">会话</p>
            <p className="mt-1 text-xs text-slate-500">仅保存在当前浏览器</p>
          </div>
          <Button
            type="button"
            variant="outline"
            className="w-full justify-start"
            onClick={createConversation}
          >
            <Plus className="size-4" aria-hidden="true" />
            新建对话
          </Button>
          <div className="mt-4 space-y-1 overflow-y-auto">
            {conversations.map((conversation) => {
              const active = conversation.id === activeConversationId;
              return (
                <button
                  key={conversation.id}
                  type="button"
                  className={`w-full rounded-lg border px-3 py-2.5 text-left ${
                    active
                      ? 'border-blue-100 bg-blue-50'
                      : 'border-transparent bg-transparent hover:border-slate-200 hover:bg-white'
                  }`}
                  onClick={() => setActiveConversationId(conversation.id)}
                >
                  <span
                    className={`block truncate text-sm font-medium ${
                      active ? 'text-blue-800' : 'text-slate-700'
                    }`}
                  >
                    {conversation.label}
                  </span>
                  <span className={`mt-1 block text-xs ${active ? 'text-blue-600' : 'text-slate-500'}`}>
                    回答将附带可核验的来源
                  </span>
                </button>
              );
            })}
          </div>
          <div className="mt-auto px-2 pb-1 text-xs leading-5 text-slate-500">
            内容仅会从你有访问权限的知识空间中检索。
          </div>
        </aside>
        <ChatWorkspaceErrorBoundary>
          {conversations.map((conversation) => (
            <ChatSession
              key={conversation.id}
              auth={auth}
              hidden={conversation.id !== activeConversationId}
              spaces={spaces}
              selectedSpaceIds={selectedSpaceIds}
              setSelectedSpaceIds={setSelectedSpaceIds}
              spacesLoading={spacesQuery.isPending}
              spacesError={spacesQuery.isError}
            />
          ))}
        </ChatWorkspaceErrorBoundary>
      </div>
    </main>
  );
}

function ChatSession({
  auth,
  hidden,
  spaces,
  selectedSpaceIds,
  setSelectedSpaceIds,
  spacesLoading,
  spacesError,
}: {
  auth: ReturnType<typeof useAuth>;
  hidden: boolean;
  spaces: VisibleSpace[];
  selectedSpaceIds: string[];
  setSelectedSpaceIds: (ids: string[]) => void;
  spacesLoading: boolean;
  spacesError: boolean;
}) {
  const selectedSpaceIdsRef = useRef<string[]>([]);
  selectedSpaceIdsRef.current = selectedSpaceIds;
  const [agentStatus, setAgentStatus] = useState<string>();
  const transport = useMemo(
    () =>
      createChatTransport({
        getAccessToken: auth.getAccessToken,
        getSelectedSpaceIds: () => selectedSpaceIdsRef.current,
        authorizedFetch: auth.authorizedFetch,
      }),
    [auth.authorizedFetch, auth.getAccessToken],
  );
  const { messages, sendMessage, status, stop, error } = useChat<RagUIMessage>({
    transport,
    onData: (part) => {
      if (part.type === 'data-agent-status') setAgentStatus(part.data.status);
    },
  });
  const displayedMessages = useThrottledMessages(messages);
  const busy = status === 'submitted' || status === 'streaming';

  return (
    <section
      className={`min-w-0 flex-1 flex-col ${hidden ? 'hidden' : 'flex'}`}
      aria-label="知识问答对话"
    >
      <ConversationView messages={displayedMessages} />
      <ChatComposer
        busy={busy}
        agentStatus={agentStatus}
        error={error}
        spaceError={spacesError ? '知识空间加载失败，请刷新页面后重试。' : undefined}
        spacesLoading={spacesLoading}
        hasSelectedSpaces={selectedSpaceIds.length > 0}
        onSend={(text) => {
          setAgentStatus(undefined);
          return sendMessage({ text });
        }}
        onStop={stop}
        scopeControl={<SpaceScopeSelector spaces={spaces} selectedIds={selectedSpaceIds} loading={spacesLoading} onChange={setSelectedSpaceIds} />}
      />
    </section>
  );
}
