import { Bot, UserRound } from 'lucide-react';

import type { RagUIMessage } from '@rag/contracts';

import { MessagePart } from './message-part';

export function ConversationView({ messages }: { messages: RagUIMessage[] }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-white px-6 py-6" aria-live="polite">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-7">
        {messages.length === 0 ? (
          <div className="flex min-h-0 flex-1 items-center justify-center py-20 text-center">
            <p className="text-sm text-slate-400">从已选择的知识空间开始提问</p>
          </div>
        ) : (
          messages.map((message) => (
            <article
              className={`flex gap-3 ${message.role === 'user' ? 'flex-row-reverse' : ''}`}
              key={message.id}
              data-role={message.role}
            >
              <span
                className={`flex size-7 shrink-0 items-center justify-center rounded-full ${
                  message.role === 'user' ? 'bg-slate-700 text-white' : 'bg-blue-700 text-white'
                }`}
                aria-hidden="true"
              >
                {message.role === 'user' ? <UserRound className="size-4" /> : <Bot className="size-4" />}
              </span>
              <div
                className={`min-w-0 max-w-[86%] rounded-2xl px-4 py-3 text-sm leading-6 ${
                  message.role === 'user'
                    ? 'bg-slate-100 text-slate-800'
                    : 'text-slate-700'
                }`}
              >
                {message.parts.map((part, index) => (
                  <MessagePart key={`${message.id}-${part.type}-${index}`} part={part} />
                ))}
              </div>
            </article>
          ))
        )}
      </div>
    </div>
  );
}
