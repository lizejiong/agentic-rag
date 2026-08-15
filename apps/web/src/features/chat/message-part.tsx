import { useState } from 'react';

import { ChevronDown, FileText, Quote } from 'lucide-react';

import type { RagUIMessage } from '@rag/contracts';

type RagMessagePart = RagUIMessage['parts'][number];

function formatLocation(location: {
  page?: number | undefined;
  slide?: number | undefined;
  sheet?: string | undefined;
  cellRange?: string | undefined;
}): string | undefined {
  if (location.page) return `第 ${location.page} 页`;
  if (location.slide) return `第 ${location.slide} 页幻灯片`;
  if (location.sheet) return location.cellRange ? `${location.sheet} · ${location.cellRange}` : location.sheet;
  return undefined;
}

function RetrievalSummaryCard({ part }: { part: Extract<RagMessagePart, { type: 'data-retrieval-summary' }> }) {
  const [expanded, setExpanded] = useState(false);
  const summary = part.data;
  return (
    <details
      className="my-3 rounded-lg border border-slate-200 bg-slate-50 text-slate-600"
      open={expanded}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 text-xs font-medium">
        <span>检索到 {summary.finalCandidateCount} 条证据{summary.rerankerEnabled ? '（已重排序）' : ''}</span>
        <span className="flex items-center gap-1 text-slate-400">{(summary.elapsedMs / 1000).toFixed(1)}s <ChevronDown className="size-3" /></span>
      </summary>
      <div className="grid gap-2 border-t border-slate-200 px-3 py-3 text-xs leading-5">
        {summary.contextualized ? <><p><span className="text-slate-400">原问题：</span>{summary.originalQuery}</p><p><span className="text-slate-400">实际检索词：</span>{summary.query}</p></> : <p><span className="text-slate-400">查询：</span>{summary.query}</p>}
        <p><span className="text-slate-400">向量召回：</span>Top {summary.vectorTopK} · {summary.embeddingModel}@{summary.embeddingVersion}</p>
        <p><span className="text-slate-400">关键词召回：</span>Top {summary.lexicalTopK}</p>
        <p><span className="text-slate-400">融合结果：</span>Top {summary.rrfTopK}（{summary.rrfCandidateCount} 候选）</p>
        {summary.rerankerEnabled ? <p><span className="text-slate-400">重排序：</span>{summary.rerankerModel}@{summary.rerankerVersion} · Top {summary.rerankTopK}</p> : null}
      </div>
    </details>
  );
}

export function MessagePart({ part }: { part: RagMessagePart }) {
  const [expanded, setExpanded] = useState(false);
  if (part.type === 'text') return <p className="whitespace-pre-wrap">{part.text}</p>;
  if (part.type === 'data-agent-status') return null;
  if (part.type === 'data-retrieval-summary') return <RetrievalSummaryCard part={part} />;
  if (part.type !== 'data-citation') return null;

  const location = formatLocation(part.data.location);
  return (
    <aside className="my-3 rounded-lg border border-blue-100 bg-blue-50/60 text-slate-700">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
        data-citation-id={part.data.citationId}
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <span className="flex size-6 shrink-0 items-center justify-center rounded bg-white text-blue-700 shadow-sm" aria-hidden="true">
          <FileText className="size-3.5" />
        </span>
        <span className="min-w-0 flex-1">
          <strong className="block truncate text-xs font-semibold">{part.data.title}</strong>
          {location ? <small className="block text-xs text-slate-500">{location}</small> : null}
        </span>
        <Quote className="size-3.5 text-blue-500" aria-hidden="true" />
      </button>
      {expanded ? <p className="border-t border-blue-100 px-3 py-2.5 text-xs leading-5 text-slate-600">{part.data.snippet || '暂无证据摘要'}</p> : null}
    </aside>
  );
}
