import { type ReactNode, useState } from 'react';

import { Send, Square } from 'lucide-react';

import { Button } from '@/components/ui/button';

export function ChatComposer({
  busy,
  error,
  spaceError,
  spacesLoading,
  hasSelectedSpaces,
  onSend,
  onStop,
  scopeControl,
}: {
  busy: boolean;
  error: Error | undefined;
  spaceError: string | undefined;
  spacesLoading: boolean;
  hasSelectedSpaces: boolean;
  onSend: (text: string) => void | Promise<void>;
  onStop: () => void | Promise<void>;
  scopeControl?: ReactNode;
}) {
  const [input, setInput] = useState('');
  const submit = () => {
    const text = input.trim();
    if (!text || busy || !hasSelectedSpaces) return;
    void onSend(text);
    setInput('');
  };

  return (
    <div className="shrink-0 bg-transparent px-8 pb-6 pt-3">
      <div className="mx-auto w-full max-w-4xl">
        {error ? <p className="mb-2 text-sm text-red-600" role="alert">服务连接已中断，请确认 API 服务后重试。</p> : null}
        {spaceError ? <p className="mb-2 text-sm text-red-600" role="alert">{spaceError}</p> : null}
        {!spacesLoading && !hasSelectedSpaces ? (
          <p className="mb-2 text-sm text-amber-700" role="status">请至少选择一个知识空间后再提问。</p>
        ) : null}
        <form
          className="rounded-2xl border border-slate-200 bg-white p-4 shadow-lg shadow-slate-200/40 transition focus-within:border-blue-300 focus-within:ring-4 focus-within:ring-blue-50"
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
            className="block min-h-14 w-full resize-none border-0 bg-transparent px-1 text-[15px] leading-7 text-slate-800 outline-none placeholder:text-slate-400"
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <div className="mt-3 flex items-center justify-between gap-3 border-t border-slate-100 pt-3">
            <div className="min-w-0">{scopeControl}</div>
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
      </div>
    </div>
  );
}
