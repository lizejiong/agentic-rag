import { useState } from 'react';

import type { RagUIMessage } from '@rag/contracts';

type RagMessagePart = RagUIMessage['parts'][number];

export function MessagePart({ part }: { part: RagMessagePart }) {
  const [expanded, setExpanded] = useState(false);

  if (part.type === 'text') {
    return <p className="message-text">{part.text}</p>;
  }
  if (part.type !== 'data-citation') {
    return null;
  }

  const location = part.data.location.page
    ? `第 ${part.data.location.page} 页`
    : part.data.location.slide
      ? `第 ${part.data.location.slide} 页幻灯片`
      : part.data.location.sheet
        ? `${part.data.location.sheet}${part.data.location.cellRange ? ` · ${part.data.location.cellRange}` : ''}`
        : undefined;

  return (
    <aside className="citation">
      <button
        type="button"
        className="citation-trigger"
        data-citation-id={part.data.citationId}
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <span className="citation-index" aria-hidden="true">
          ↗
        </span>
        <span>
          <strong>{part.data.title}</strong>
          {location ? <small>{location}</small> : null}
        </span>
      </button>
      {expanded ? (
        <p className="citation-snippet">{part.data.snippet || '暂无证据摘要'}</p>
      ) : null}
    </aside>
  );
}
