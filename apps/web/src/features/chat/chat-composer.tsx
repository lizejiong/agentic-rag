import { useState } from 'react';

import { Send, Square } from 'lucide-react';

import { Button } from '@/components/ui/button';

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
    if (!text || busy || !hasSelectedSpaces) return;
    void onSend(text);
    setInput('');
  };

  return (
    <div className="shrink-0 bg-white px-6 pb-4 pt-2">
      <div className="mx-auto w-full max-w-3xl">
        <div className="mb-1 flex min-h-5 items-center gap-2 text-xs text-slate-500" aria-live="polite">
          {busy ? <span className="size-1.5 animate-pulse rounded-full bg-blue-600" aria-hidden="true" /> : null}
          {agentStatus
            ? STATUS_LABELS[agentStatus] ?? agentStatus
            : busy
              ? '正在连接知识服务'
              : '回答会附带可核验的引用来源'}
        </div>
        {error ? <p className="mb-2 text-sm text-red-600" role="alert">{error.message}</p> : null}
        {spaceError ? <p className="mb-2 text-sm text-red-600" role="alert">{spaceError}</p> : null}
        {!spacesLoading && !hasSelectedSpaces ? (
          <p className="mb-2 text-sm text-amber-700" role="status">请至少选择一个知识空间后再提问。</p>
        ) : null}
        <form
          className="rounded-2xl border border-slate-300 bg-white p-3 shadow-sm focus-within:border-slate-400 focus-within:ring-2 focus-within:ring-slate-100"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <label htmlFor="question" className="sr-only">向企业知识库提问</label>
          <textarea
            id="question"
            rows={2}
            value={input}
            maxLength={8000}
            placeholder="例如：请总结差旅报销制度，并给出原文出处"
            className="block w-full resize-none border-0 bg-transparent px-1 text-sm leading-6 text-slate-800 outline-none placeholder:text-slate-400"
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-2">
            <small className="text-xs text-slate-400">Enter 发送 · Shift + Enter 换行</small>
            {busy ? (
              <Button type="button" variant="outline" size="sm" onClick={() => void onStop()}>
                <Square className="size-3" aria-hidden="true" />
                停止生成
              </Button>
            ) : (
              <Button type="submit" size="sm" disabled={!input.trim() || !hasSelectedSpaces}>
                发送
                <Send className="size-3.5" aria-hidden="true" />
              </Button>
            )}
          </div>
        </form>
        <p className="mt-2 text-center text-xs text-slate-400">AI 生成内容可能存在偏差，请核对引用来源。</p>
      </div>
    </div>
  );
}
