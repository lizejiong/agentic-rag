import { useEffect, useMemo, useRef, useState } from 'react';

import { useChat } from '@ai-sdk/react';
import type { RagUIMessage } from '@rag/contracts';
import { z } from 'zod';

import { useAuth } from '../auth/auth-provider';
import { SpacePicker, type VisibleSpace } from '../spaces/space-picker';
import { createChatTransport } from './chat-transport';
import { MessagePart } from './message-part';

const STATUS_LABELS: Record<string, string> = {
  understanding: '正在理解问题',
  retrieving: '正在检索知识库',
  ranking: '正在重排证据',
  answering: '正在组织答案',
  cancelled: '已停止生成',
};

const visibleSpacesSchema = z.array(
  z.object({
    id: z.uuid(),
    name: z.string(),
    description: z.string().nullable(),
    effectivePermission: z.enum(['VIEW', 'EDIT', 'MANAGE']),
  }),
);

export function ChatPage() {
  const auth = useAuth();
  const [spaces, setSpaces] = useState<VisibleSpace[]>([]);
  const [spacesLoading, setSpacesLoading] = useState(true);
  const [spaceError, setSpaceError] = useState<string>();
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
  const [input, setInput] = useState('');
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
    const controller = new AbortController();
    let active = true;
    setSpacesLoading(true);
    void auth
      .authorizedFetch('/api/spaces', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`SPACE_LIST_${response.status}`);
        }
        const visible = visibleSpacesSchema.parse(await response.json());
        if (!active) {
          return;
        }
        setSpaces(visible);
        setSelectedSpaceIds((current) => {
          const stillVisible = current.filter((id) => visible.some((space) => space.id === id));
          return stillVisible.length > 0
            ? stillVisible
            : visible[0]
              ? [visible[0].id]
              : [];
        });
        setSpaceError(undefined);
      })
      .catch((caught: unknown) => {
        if (active && !(caught instanceof DOMException && caught.name === 'AbortError')) {
          setSpaceError('知识空间加载失败，请重新登录后重试');
        }
      })
      .finally(() => {
        if (active) {
          setSpacesLoading(false);
        }
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [auth.authorizedFetch]);

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
          loading={spacesLoading}
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

          <div className="message-list" aria-live="polite">
            {messages.length === 0 ? (
              <div className="empty-state">
                <div className="orb" aria-hidden="true">
                  <span />
                </div>
                <h2>今天想了解什么？</h2>
                <p>
                  提问后，系统会检索企业知识并在答案中标注可以核验的来源。
                </p>
              </div>
            ) : (
              messages.map((message) => (
                <article
                  className={`message message-${message.role}`}
                  key={message.id}
                  data-role={message.role}
                >
                  <div className="message-author">
                    {message.role === 'user' ? '你' : 'Atlas'}
                  </div>
                  <div className="message-content">
                    {message.parts.map((part, index) => (
                      <MessagePart
                        key={`${message.id}-${part.type}-${index}`}
                        part={part}
                      />
                    ))}
                  </div>
                </article>
              ))
            )}
          </div>

          <div className="composer-wrap">
            <div className="agent-state" aria-live="polite">
              {busy ? <span className="pulse" aria-hidden="true" /> : null}
              {agentStatus
                ? STATUS_LABELS[agentStatus] ?? agentStatus
                : busy
                  ? '正在连接知识服务'
                  : '可以开始提问'}
            </div>
            {error ? <p role="alert">{error.message}</p> : null}
            {spaceError ? <p role="alert">{spaceError}</p> : null}
            {!spacesLoading && selectedSpaceIds.length === 0 ? (
              <p className="space-required" role="status">
                请至少选择一个知识空间后再提问
              </p>
            ) : null}
            <form
              className="composer"
              onSubmit={(event) => {
                event.preventDefault();
                const text = input.trim();
                if (!text || busy || selectedSpaceIds.length === 0) {
                  return;
                }
                setAgentStatus(undefined);
                void sendMessage({ text });
                setInput('');
              }}
            >
              <label htmlFor="question">向企业知识库提问</label>
              <textarea
                id="question"
                rows={3}
                value={input}
                maxLength={8000}
                placeholder="例如：请总结差旅报销制度，并给出原文出处"
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (
                    event.key === 'Enter' &&
                    !event.shiftKey &&
                    !event.nativeEvent.isComposing
                  ) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
              />
              <div className="composer-actions">
                <small>Enter 发送 · Shift + Enter 换行</small>
                {busy ? (
                  <button
                    type="button"
                    className="stop-button"
                    onClick={() => void stop()}
                  >
                    <span aria-hidden="true" />
                    停止生成
                  </button>
                ) : (
                  <button
                    type="submit"
                    className="send-button"
                    disabled={!input.trim() || selectedSpaceIds.length === 0}
                  >
                    发送
                    <span aria-hidden="true">↗</span>
                  </button>
                )}
              </div>
            </form>
            <p className="disclaimer">
              AI 生成内容可能存在偏差，重要结论请核对引用来源。
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}
