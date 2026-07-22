import { useEffect, useMemo, useRef, useState } from 'react';

import { useChat } from '@ai-sdk/react';
import type { RagUIMessage } from '@rag/contracts';

import { useAuth } from '../auth/auth-provider';
import { SpacePicker } from '../spaces/space-picker';
import { useSpacesQuery } from '../spaces/use-spaces-query';
import { ChatComposer } from './chat-composer';
import { createChatTransport } from './chat-transport';
import { ConversationView } from './conversation-view';

export function ChatPage() {
  const auth = useAuth();
  const spacesQuery = useSpacesQuery(auth.authorizedFetch);
  const spaces = spacesQuery.data ?? [];
  const [selectedSpaceIds, setSelectedSpaceIds] = useState<string[]>([]);
  const selectedSpaceIdsRef = useRef<string[]>([]);
  selectedSpaceIdsRef.current = selectedSpaceIds;

  const transport = useMemo(
    () =>
      createChatTransport({
        getAccessToken: auth.getAccessToken,
        getSelectedSpaceIds: () => selectedSpaceIdsRef.current,
        authorizedFetch: auth.authorizedFetch,
      }),
    [auth.authorizedFetch, auth.getAccessToken],
  );
  const [agentStatus, setAgentStatus] = useState<string>();
  const { messages, sendMessage, status, stop, error } = useChat<RagUIMessage>({
    transport,
    onData: (part) => {
      if (part.type === 'data-agent-status') {
        setAgentStatus(part.data.status);
      }
    },
  });
  const busy = status === 'submitted' || status === 'streaming';

  useEffect(() => {
    if (!spacesQuery.data) {
      return;
    }
    setSelectedSpaceIds((current) => {
      const stillVisible = current.filter((id) =>
        spacesQuery.data.some((space) => space.id === id),
      );
      return stillVisible.length > 0
        ? stillVisible
        : spacesQuery.data[0]
          ? [spacesQuery.data[0].id]
          : [];
    });
  }, [spacesQuery.data]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Atlas RAG 首页">
          <span className="brand-mark" aria-hidden="true">
            A
          </span>
          <span>
            <strong>Atlas RAG</strong>
            <small>企业知识智能</small>
          </span>
        </a>
        <div className="account-state">
          {selectedSpaceIds[0] ? (
            <a href={`/spaces/${selectedSpaceIds[0]}/documents`}>文档管理</a>
          ) : null}
          <span>{auth.user?.username}</span>
          <button type="button" onClick={() => void auth.logout()}>
            退出
          </button>
        </div>
      </header>

      <main className="chat-layout">
        <SpacePicker
          spaces={spaces}
          selectedIds={selectedSpaceIds}
          onChange={setSelectedSpaceIds}
          loading={spacesQuery.isPending}
        />
        <section className="conversation" aria-label="知识问答对话">
          <div className="conversation-heading">
            <div>
              <p className="eyebrow">KNOWLEDGE ASSISTANT</p>
              <h1>从知识中，找到可信答案</h1>
            </div>
            <div className="capabilities" aria-label="检索能力">
              <span>混合检索</span>
              <span>图谱推理</span>
              <span>来源可追溯</span>
            </div>
          </div>

          <ConversationView messages={messages} />
          <ChatComposer
            busy={busy}
            agentStatus={agentStatus}
            error={error}
            spaceError={spacesQuery.isError ? '知识空间加载失败，请重新登录后重试' : undefined}
            spacesLoading={spacesQuery.isPending}
            hasSelectedSpaces={selectedSpaceIds.length > 0}
            onSend={(text) => {
              setAgentStatus(undefined);
              return sendMessage({ text });
            }}
            onStop={stop}
          />
        </section>
      </main>
    </div>
  );
}
