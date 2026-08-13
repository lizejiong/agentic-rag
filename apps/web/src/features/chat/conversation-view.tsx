import { useEffect, useRef } from 'react';

import type { RagUIMessage } from '@rag/contracts';

import { AssistantActivity } from './assistant-activity';
import { MessagePart } from './message-part';

function hasText(message: RagUIMessage) {
  return message.parts.some((part) => part.type === 'text' && part.text.trim().length > 0);
}

export function ConversationView({
  messages,
  busy = false,
  agentStatus,
}: {
  messages: RagUIMessage[];
  busy?: boolean;
  agentStatus?: string | undefined;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const shouldFollowRef = useRef(true);
  const latestAssistantIndex = messages.map((message) => message.role).lastIndexOf('assistant');
  useEffect(() => {
    const container = scrollRef.current;
    if (container && shouldFollowRef.current) container.scrollTo({ top: container.scrollHeight });
  }, [messages]);
  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50/40 px-8 py-7" aria-live="polite" onScroll={(event) => { const target = event.currentTarget; shouldFollowRef.current = target.scrollHeight - target.scrollTop - target.clientHeight < 72; }} ref={scrollRef}>
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-8">
        {messages.length === 0 ? (
          <div className="flex min-h-0 flex-1 items-center justify-center py-20 text-center" />
        ) : (
          messages.map((message, index) => (
            <article
              className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
              key={message.id}
              data-role={message.role}
            >
              <div
                className={`min-w-0 text-sm leading-7 ${
                  message.role === 'user'
                    ? 'max-w-[72%] rounded-2xl bg-slate-100 px-4 py-3 text-slate-800'
                    : 'w-full text-slate-700'
                }`}
              >
                {busy && index === latestAssistantIndex ? (
                  <AssistantActivity status={agentStatus} compact={hasText(message)} />
                ) : null}
                {message.parts.map((part, index) => (
                  <MessagePart key={`${message.id}-${part.type}-${index}`} part={part} />
                ))}
              </div>
            </article>
          ))
        )}
        {busy && latestAssistantIndex === -1 ? (
          <article className="flex justify-start" data-role="assistant">
            <div className="min-w-0 text-sm leading-7 text-slate-700">
              <AssistantActivity status={agentStatus} compact={false} />
            </div>
          </article>
        ) : null}
        <div ref={endRef} />
      </div>
    </div>
  );
}
