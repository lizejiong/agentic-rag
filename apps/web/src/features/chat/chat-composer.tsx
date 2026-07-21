import { useState } from 'react';

const STATUS_LABELS: Record<string, string> = {
  understanding: '正在理解问题',
  retrieving: '正在检索知识库',
  ranking: '正在重排证据',
  answering: '正在组织答案',
  cancelled: '已停止生成',
};

export function ChatComposer({
  busy,
  agentStatus,
  error,
  spaceError,
  spacesLoading,
  hasSelectedSpaces,
  onSend,
  onStop,
}: {
  busy: boolean;
  agentStatus: string | undefined;
  error: Error | undefined;
  spaceError: string | undefined;
  spacesLoading: boolean;
  hasSelectedSpaces: boolean;
  onSend: (text: string) => void | Promise<void>;
  onStop: () => void | Promise<void>;
}) {
  const [input, setInput] = useState('');

  const submit = () => {
    const text = input.trim();
    if (!text || busy || !hasSelectedSpaces) {
      return;
    }
    void onSend(text);
    setInput('');
  };

  return (
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
      {!spacesLoading && !hasSelectedSpaces ? (
        <p className="space-required" role="status">
          请至少选择一个知识空间后再提问
        </p>
      ) : null}
      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
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
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <div className="composer-actions">
          <small>Enter 发送 · Shift + Enter 换行</small>
          {busy ? (
            <button type="button" className="stop-button" onClick={() => void onStop()}>
              <span aria-hidden="true" />
              停止生成
            </button>
          ) : (
            <button
              type="submit"
              className="send-button"
              disabled={!input.trim() || !hasSelectedSpaces}
            >
              发送
              <span aria-hidden="true">↑</span>
            </button>
          )}
        </div>
      </form>
      <p className="disclaimer">AI 生成内容可能存在偏差，重要结论请核对引用来源。</p>
    </div>
  );
}
