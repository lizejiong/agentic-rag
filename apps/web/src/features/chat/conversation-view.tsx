import type { RagUIMessage } from '@rag/contracts';

import { MessagePart } from './message-part';

export function ConversationView({ messages }: { messages: RagUIMessage[] }) {
  return (
    <div className="message-list" aria-live="polite">
      {messages.length === 0 ? (
        <div className="empty-state">
          <div className="orb" aria-hidden="true">
            <span />
          </div>
          <h2>今天想了解什么？</h2>
          <p>提问后，系统会检索企业知识并在答案中标注可以核验的来源。</p>
        </div>
      ) : (
        messages.map((message) => (
          <article
            className={`message message-${message.role}`}
            key={message.id}
            data-role={message.role}
          >
            <div className="message-author">{message.role === 'user' ? '你' : 'Atlas'}</div>
            <div className="message-content">
              {message.parts.map((part, index) => (
                <MessagePart key={`${message.id}-${part.type}-${index}`} part={part} />
              ))}
            </div>
          </article>
        ))
      )}
    </div>
  );
}
