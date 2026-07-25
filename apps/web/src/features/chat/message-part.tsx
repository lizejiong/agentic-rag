import { useState } from 'react';

import type { RagUIMessage } from '@rag/contracts';

type RagMessagePart = RagUIMessage['parts'][number];

const STATUS_LABELS: Record<string, string> = {
  understanding: '理解问题',
  retrieving: '检索资料',
  ranking: '排序证据',
  answering: '生成回答',
  cancelled: '已取消',
};

function formatLocation(location: {
  page?: number;
  slide?: number;
  sheet?: string;
  cellRange?: string;
}): string | undefined {
  if (location.page) return `第 ${location.page} 页`;
  if (location.slide) return `第 ${location.slide} 页幻灯片`;
  if (location.sheet) {
    return location.cellRange
      ? `${location.sheet} · ${location.cellRange}`
      : location.sheet;
  }
  return undefined;
}

function StatusBadge({ part }: { part: Extract<RagMessagePart, { type: 'data-agent-status' }> }) {
  const label = STATUS_LABELS[part.data.status] ?? part.data.status;
  return (
    <span className="agent-status-badge" aria-live="polite">
      <span className="status-dot" aria-hidden="true" />
      {label}
    </span>
  );
}

function RetrievalSummaryCard({
  part,
}: {
  part: Extract<RagMessagePart, { type: 'data-retrieval-summary' }>;
}) {
  const [expanded, setExpanded] = useState(false);
  const summary = part.data;
  const hasReranker = summary.rerankerEnabled;

  return (
    <details
      className="retrieval-summary"
      open={expanded}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary className="retrieval-summary-trigger">
        <span className="summary-icon" aria-hidden="true">
          🔍
        </span>
        <span>
          检索到 {summary.finalCandidateCount} 条证据
          {hasReranker ? '（已重排序）' : ''}
          <small> · {(summary.elapsedMs / 1000).toFixed(1)}s</small>
        </span>
      </summary>
      <div className="retrieval-summary-body">
        <dl>
          <dt>查询</dt>
          <dd>{summary.query}</dd>
          <dt>向量召回</dt>
          <dd>
            Top {summary.vectorTopK} · 模型 {summary.embeddingModel}@{summary.embeddingVersion}
          </dd>
          <dt>关键词召回</dt>
          <dd>Top {summary.lexicalTopK}</dd>
          <dt>RRF 融合</dt>
          <dd>
            k={summary.rrfK} → Top {summary.rrfTopK}（{summary.rrfCandidateCount} 候选）
          </dd>
          {hasReranker ? (
            <dt>重排序</dt>
          ) : null}
          {hasReranker ? (
            <dd>
              {summary.rerankerModel}@{summary.rerankerVersion} → Top {summary.rerankTopK}
            </dd>
          ) : null}
        </dl>
        {summary.paths.length > 0 ? (
          <ul className="retrieval-paths">
            {summary.paths.map((path) => (
              <li key={path.path}>
                <span className={`path-badge path-${path.path}`}>{path.path}</span>
                <span>
                  {path.candidatesReturned} 召回 · {path.candidatesAfterAcl ?? 0} 授权
                </span>
                {path.error ? <small className="path-error">{path.error}</small> : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </details>
  );
}

export function MessagePart({ part }: { part: RagMessagePart }) {
  const [expanded, setExpanded] = useState(false);

  if (part.type === 'text') {
    return <p className="message-text">{part.text}</p>;
  }

  if (part.type === 'data-agent-status') {
    return <StatusBadge part={part} />;
  }

  if (part.type === 'data-retrieval-summary') {
    return <RetrievalSummaryCard part={part} />;
  }

  if (part.type !== 'data-citation') {
    return null;
  }

  const location = formatLocation(part.data.location);

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
