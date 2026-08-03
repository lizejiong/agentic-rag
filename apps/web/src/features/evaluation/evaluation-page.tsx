import { useQuery } from '@tanstack/react-query';
import { FileUp, Play, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';

import { Button } from '@/components/ui/button';
import { useAuth } from '@/features/auth/auth-provider';
import { useSpacesQuery } from '@/features/spaces/use-spaces-query';

type Mode = 'retrieval' | 'full';
type Stage = 'vector' | 'lexical' | 'rrf' | 'rerank';
type DatasetSummary = { id: string; name: string; spaceId: string; _count: { cases: number } };
type Dataset = DatasetSummary & { cases: Array<{ id: string; question: string }> };
type StageMetrics = { hitAt1: number; hitAt5: number; hitAt10: number; mrr: number; firstExpectedRank?: number | null };
type TraceItem = { chunkId: string; documentTitle: string; content: string; score: number; rank: number };
type ExpectedEvidence = { document: string; anchor: string; quote: string };
type EvaluationResult = {
  id: string;
  question: string;
  effectiveQuery: string;
  error?: string | null;
  answer?: string | null;
  elapsedMs: number;
  answerPointCoverage?: number | null;
  citationEvidencePrecision?: number | null;
  refusalCorrect?: boolean | null;
  referenceAnswer?: string | null;
  expectedEvidence?: ExpectedEvidence[];
  expectedAnswerPoints?: string[];
  stages: Record<Stage, StageMetrics>;
  trace: Record<Stage, TraceItem[]>;
};
type EvaluationSummary = {
  caseCount: number;
  completedCaseCount: number;
  failedCaseCount: number;
  averageElapsedMs: number;
  answerPointCoverage?: number;
  citationEvidencePrecision?: number;
  refusalCorrect?: number;
  stages: Record<Stage, StageMetrics>;
};
type Run = {
  id: string;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED';
  error?: string | null;
  summary?: EvaluationSummary | null;
  results?: EvaluationResult[];
};
type PendingImport = { content: string; fileName: string; incomingCaseCount: number; existingCaseCount: number };

const stageLabels: Record<Stage, string> = {
  vector: '向量检索',
  lexical: '关键词检索（ES）',
  rrf: '融合排序（RRF）',
  rerank: '重排序（Reranker）',
};
const stageOrder: Stage[] = ['vector', 'lexical', 'rrf', 'rerank'];
const percentage = (value: number | null | undefined) => value == null ? '—' : `${Math.round(value * 100)}%`;
const compactStageLabels: Record<Stage, string> = { vector: '向量', lexical: 'ES', rrf: '融合', rerank: '重排' };

function isExpectedChunk(chunk: TraceItem, evidence: ExpectedEvidence) {
  const documentTitle = chunk.documentTitle.toLocaleLowerCase();
  const document = evidence.document.toLocaleLowerCase();
  return (documentTitle.includes(document) || document.includes(documentTitle))
    && chunk.content.toLocaleLowerCase().includes(evidence.quote.toLocaleLowerCase());
}

function matchingEvidence(chunk: TraceItem, expectedEvidence: ExpectedEvidence[]) {
  return expectedEvidence.filter((evidence) => isExpectedChunk(chunk, evidence));
}

async function requestJson<T>(fetcher: ReturnType<typeof useAuth>['authorizedFetch'], url: string, init?: RequestInit): Promise<T> {
  const response = await fetcher(url, init);
  if (!response.ok) throw new Error((await response.text()) || `HTTP_${response.status}`);
  return response.json() as Promise<T>;
}

function EvaluationReportDrawer({
  run,
  caseCount,
  selectedResultId,
  selectedStage,
  onClose,
  onSelectResult,
  onSelectStage,
}: {
  run: Run;
  caseCount: number;
  selectedResultId: string | undefined;
  selectedStage: Stage;
  onClose: () => void;
  onSelectResult: (id: string) => void;
  onSelectStage: (stage: Stage) => void;
}) {
  const summary = run.summary;
  const results = run.results ?? [];
  const [resultFilter, setResultFilter] = useState<'all' | 'attention' | 'passed'>('all');
  const isAttentionRequired = (result: EvaluationResult) => Boolean(result.error)
    || !result.stages.rerank.hitAt10
    || (result.answerPointCoverage != null && result.answerPointCoverage < 1);
  const visibleResults = results.filter((result) => resultFilter === 'all'
    || (resultFilter === 'attention' ? isAttentionRequired(result) : !isAttentionRequired(result)));
  const selectedResult = results.find((item) => item.id === selectedResultId) ?? results[0];
  const expectedEvidence = selectedResult?.expectedEvidence ?? [];
  const stageChunks = selectedResult?.trace[selectedStage] ?? [];
  const matchedEvidenceCount = expectedEvidence.filter((evidence) => stageChunks.some((chunk) => isExpectedChunk(chunk, evidence))).length;

  if (!summary) return null;

  return <div className="fixed inset-0 z-50">
    <button aria-label="关闭报告" className="absolute inset-0 bg-slate-950/20" onClick={onClose} />
    <aside aria-label="评测报告" className="absolute inset-0 flex min-h-0 flex-col overflow-hidden border-l border-slate-200 bg-white shadow-2xl" style={{ width: 'min(92vw, 1280px)', left: 'auto' }}>
      <header className="flex shrink-0 items-start justify-between border-b border-slate-200 px-6 py-4">
        <div>
          <p className="text-sm font-medium text-blue-700">质量评测报告</p>
          <h2 className="mt-1 text-xl font-semibold text-slate-950">{caseCount} 道题的运行结果</h2>
          <p className="mt-1 text-sm text-slate-500">先定位需要关注的题，再核对正确证据在各阶段的排名。</p>
        </div>
        <Button aria-label="关闭报告" size="icon" variant="ghost" onClick={onClose}><X size={18} /></Button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden p-5">
        <section className="grid shrink-0 grid-cols-[1.3fr_1fr] gap-3">
          <div className="overflow-hidden rounded-lg border border-slate-200">
            <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2"><h3 className="text-sm font-medium text-slate-950">检索阶段表现</h3><span className="text-xs text-slate-500">按可回答题计算</span></div>
            <table className="w-full text-left text-xs"><thead className="bg-slate-50 text-slate-500"><tr><th className="px-3 py-1.5 font-medium">阶段</th><th className="px-2 py-1.5 font-medium">H@1</th><th className="px-2 py-1.5 font-medium">H@5</th><th className="px-2 py-1.5 font-medium">H@10</th><th className="px-2 py-1.5 font-medium">MRR</th></tr></thead><tbody>{stageOrder.map((stage) => <tr key={stage} className="border-t border-slate-100"><td className="px-3 py-1.5 font-medium text-slate-800">{compactStageLabels[stage]}</td><td className="px-2 py-1.5">{percentage(summary.stages[stage].hitAt1)}</td><td className="px-2 py-1.5">{percentage(summary.stages[stage].hitAt5)}</td><td className="px-2 py-1.5 font-medium text-slate-900">{percentage(summary.stages[stage].hitAt10)}</td><td className="px-2 py-1.5">{summary.stages[stage].mrr.toFixed(3)}</td></tr>)}</tbody></table>
          </div>
          <div className="grid grid-cols-3 gap-3 rounded-lg border border-slate-200 p-3">
            <div><p className="text-xs text-slate-500">要点覆盖</p><p className="mt-1 text-xl font-semibold text-slate-950">{percentage(summary.answerPointCoverage)}</p></div>
            <div><p className="text-xs text-slate-500">引用准确率</p><p className="mt-1 text-xl font-semibold text-slate-950">{percentage(summary.citationEvidencePrecision)}</p></div>
            <div><p className="text-xs text-slate-500">拒答正确率</p><p className="mt-1 text-xl font-semibold text-slate-950">{percentage(summary.refusalCorrect)}</p><p className="mt-1 text-xs leading-4 text-slate-500">仅应拒答题</p></div>
          </div>
        </section>

        <section className="flex min-h-0 flex-1 flex-col">
          <div className="mb-2 flex shrink-0 items-center justify-between">
            <div><h3 className="font-medium text-slate-950">逐题诊断</h3><p className="mt-0.5 text-xs text-slate-500">左侧定位问题，右侧核对正确证据与实际排序。</p></div>
            <span className="text-xs text-slate-500">{visibleResults.length} / {results.length} 题</span>
          </div>
          <div className="grid min-h-0 flex-1 overflow-hidden rounded-xl border border-slate-200" style={{ gridTemplateColumns: 'minmax(340px, 0.38fr) minmax(0, 0.62fr)', gridTemplateRows: 'minmax(0, 1fr)' }}>
            <div className="flex min-h-0 min-w-0 flex-col border-r border-slate-200 bg-white">
              <div className="flex shrink-0 gap-1 border-b border-slate-100 p-2" aria-label="题目筛选">
                {([{ value: 'all', label: '全部' }, { value: 'attention', label: '待关注' }, { value: 'passed', label: '已通过' }] as const).map((filter) => <button key={filter.value} className={`rounded-md px-2.5 py-1.5 text-xs font-medium ${resultFilter === filter.value ? 'bg-blue-50 text-blue-700' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'}`} onClick={() => setResultFilter(filter.value)}>{filter.label}</button>)}
              </div>
              <div className="min-h-0 overflow-y-auto overscroll-contain">
              {visibleResults.map((result) => <button key={result.id} className={`block w-full border-b border-slate-100 px-4 py-3 text-left hover:bg-slate-50 ${selectedResult?.id === result.id ? 'bg-blue-50/70' : ''}`} onClick={() => onSelectResult(result.id)}><div className="flex items-start justify-between gap-3"><p className="line-clamp-2 text-sm font-medium leading-5 text-slate-800">{result.question}</p><span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${result.error ? 'bg-red-100 text-red-700' : isAttentionRequired(result) ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-700'}`}>{result.error ? '失败' : isAttentionRequired(result) ? '待关注' : '通过'}</span></div><div className="mt-2 flex items-center justify-between gap-2 text-xs text-slate-500"><span>{result.error ? '执行失败' : `重排 ${percentage(result.stages.rerank.hitAt10)}`}</span><span>{result.answerPointCoverage != null ? `要点 ${percentage(result.answerPointCoverage)}` : '未评回答'}</span><span>{Math.round(result.elapsedMs)}ms</span></div></button>)}
              {!visibleResults.length ? <p className="p-4 text-sm text-slate-500">该筛选下没有题目。</p> : null}
              </div>
            </div>
            <div className="min-h-0 min-w-0 overflow-x-hidden overflow-y-auto overscroll-contain bg-slate-50/60 p-4">
              {selectedResult ? <>
                <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-medium text-slate-500">当前题目</p><h4 className="mt-1 text-base font-medium leading-6 text-slate-950">{selectedResult.question}</h4>{selectedResult.effectiveQuery !== selectedResult.question ? <p className="mt-1 text-sm text-slate-500">实际检索词：{selectedResult.effectiveQuery}</p> : null}</div><span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${selectedResult.error ? 'bg-red-100 text-red-700' : selectedResult.stages.rerank.hitAt10 ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{selectedResult.error ? '执行失败' : selectedResult.stages.rerank.hitAt10 ? '命中预期证据' : '未命中预期证据'}</span></div>
                {selectedResult.error ? <p className="mt-3 text-sm text-red-700">{selectedResult.error}</p> : <><section className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50/50 p-3"><div className="flex items-center justify-between gap-3"><div><p className="text-sm font-medium text-emerald-950">本题正确证据</p><p className="mt-0.5 text-xs text-emerald-800">题库标注的应命中 Chunk，按文档名和原文片段识别。</p></div><span className="shrink-0 text-xs font-medium text-emerald-800">{expectedEvidence.length} 条</span></div><div className="mt-3 space-y-2">{expectedEvidence.map((evidence, index) => <article key={`${evidence.document}-${evidence.anchor}-${index}`} className="rounded-md border border-emerald-100 bg-white p-2.5"><p className="text-sm font-medium text-slate-800">{evidence.document}<span className="ml-2 text-xs font-normal text-slate-500">{evidence.anchor}</span></p><p className="mt-1 text-sm leading-5 text-slate-600">{evidence.quote}</p></article>)}{!expectedEvidence.length ? <p className="text-sm text-slate-500">这次历史运行没有保存标准证据，请重新运行后查看。</p> : null}</div></section><section className="mt-4"><div className="flex items-center justify-between gap-3"><h5 className="text-sm font-medium text-slate-950">检索过程</h5><span className={`text-xs font-medium ${matchedEvidenceCount === expectedEvidence.length && expectedEvidence.length ? 'text-emerald-700' : 'text-amber-700'}`}>当前阶段命中 {matchedEvidenceCount} / {expectedEvidence.length} 条正确证据</span></div><div className="mt-2 grid grid-cols-4 gap-1 rounded-lg border border-slate-200 bg-white p-1">{stageOrder.map((stage) => <button key={stage} className={`rounded-md px-2 py-2 text-sm ${selectedStage === stage ? 'bg-blue-600 font-medium text-white' : 'text-slate-600 hover:bg-slate-50'}`} onClick={() => onSelectStage(stage)}>{compactStageLabels[stage]}</button>)}</div><div className="mt-3 space-y-2">{stageChunks.map((chunk) => { const evidence = matchingEvidence(chunk, expectedEvidence); return <article key={`${selectedStage}-${chunk.chunkId}`} className={`rounded-lg border bg-white p-3 ${evidence.length ? 'border-emerald-300 ring-1 ring-emerald-100' : 'border-slate-200'}`}><div className="flex items-center justify-between gap-3"><p className="truncate font-medium text-slate-800">#{chunk.rank} · {chunk.documentTitle}</p><div className="flex shrink-0 items-center gap-2">{evidence.length ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">预期证据</span> : null}<span className="text-xs text-slate-500">分数 {chunk.score.toFixed(4)}</span></div></div>{evidence.map((item) => <p key={`${item.document}-${item.anchor}`} className="mt-1 text-xs text-emerald-700">匹配：{item.document} · {item.anchor}</p>)}<p className="mt-2 text-sm leading-5 text-slate-600">{chunk.content}</p></article>; })}{!stageChunks.length ? <p className="text-sm text-slate-500">该阶段没有返回 Chunk。</p> : null}</div></section>{selectedResult.answer ? <section className="mt-4 border-t border-slate-200 pt-4"><p className="text-sm font-medium text-slate-900">模型回答</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{selectedResult.answer}</p></section> : null}</>}
              </> : <p className="text-sm text-slate-500">请选择一题查看详情。</p>}
            </div>
          </div>
        </section>
      </div>
    </aside>
  </div>;
}

export function EvaluationPage() {
  const auth = useAuth();
  const spaces = useSpacesQuery(auth.authorizedFetch);
  const datasets = useQuery({ queryKey: ['evaluation-datasets'], queryFn: () => requestJson<{ datasets: DatasetSummary[] }>(auth.authorizedFetch, '/api/evaluations/datasets') });
  const [datasetId, setDatasetId] = useState<string>();
  const dataset = useQuery({ queryKey: ['evaluation-dataset', datasetId], queryFn: () => requestJson<Dataset>(auth.authorizedFetch, `/api/evaluations/datasets/${datasetId}`), enabled: Boolean(datasetId) });
  const runs = useQuery({ queryKey: ['evaluation-runs', datasetId], queryFn: () => requestJson<{ runs: Run[] }>(auth.authorizedFetch, `/api/evaluations/datasets/${datasetId}/runs`), enabled: Boolean(datasetId) });
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [spaceId, setSpaceId] = useState('');
  const [mode, setMode] = useState<Mode>('full');
  const [pendingImport, setPendingImport] = useState<PendingImport>();
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [run, setRun] = useState<Run>();
  const [reportOpen, setReportOpen] = useState(false);
  const [selectedResultId, setSelectedResultId] = useState<string>();
  const [selectedStage, setSelectedStage] = useState<Stage>('rerank');
  const [error, setError] = useState<string>();
  const fileInput = useRef<HTMLInputElement>(null);
  const restoredDatasetId = useRef<string | undefined>(undefined);
  const runDetail = useQuery({ queryKey: ['evaluation-run', run?.id], queryFn: () => requestJson<Run>(auth.authorizedFetch, `/api/evaluations/runs/${run?.id}`), enabled: Boolean(run?.id && run.status === 'COMPLETED' && !run.results) });
  const reportVisible = reportOpen && run?.status === 'COMPLETED' && Boolean(run.summary);

  useEffect(() => { if (!datasetId && datasets.data?.datasets[0]) setDatasetId(datasets.data.datasets[0].id); }, [datasetId, datasets.data]);
  useEffect(() => {
    const latestRun = runs.data?.runs[0];
    if (!datasetId || !latestRun || restoredDatasetId.current === datasetId) return;
    restoredDatasetId.current = datasetId;
    setRun(latestRun);
  }, [datasetId, runs.data]);
  useEffect(() => { if (runDetail.data) setRun(runDetail.data); }, [runDetail.data]);
  useEffect(() => {
    if (!reportVisible) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, [reportVisible]);
  useEffect(() => {
    if (!reportVisible) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setReportOpen(false); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [reportVisible]);
  const space = (spaces.data ?? []).find((item) => item.id === dataset.data?.spaceId);
  if (auth.user?.role !== 'ADMIN') return null;

  const resetRunView = () => {
    setRun(undefined);
    setReportOpen(false);
    setSelectedResultId(undefined);
    setSelectedStage('rerank');
  };

  const create = async () => {
    if (!name.trim() || !spaceId) return;
    const created = await requestJson<DatasetSummary>(auth.authorizedFetch, '/api/evaluations/datasets', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, spaceId }) });
    await datasets.refetch();
    setDatasetId(created.id);
    setCreating(false);
    setName('');
    setSpaceId('');
  };
  const chooseFile = async (file: File) => {
    if (!datasetId) return;
    const content = await file.text();
    const preview = await requestJson<{ incomingCaseCount: number; existingCaseCount: number }>(auth.authorizedFetch, `/api/evaluations/datasets/${datasetId}/cases:preview`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content }) });
    setPendingImport({ content, fileName: file.name, ...preview });
  };
  const confirmImport = async () => {
    if (!datasetId || !pendingImport) return;
    await requestJson(auth.authorizedFetch, `/api/evaluations/datasets/${datasetId}/cases:import`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: pendingImport.content }) });
    setPendingImport(undefined);
    resetRunView();
    await dataset.refetch();
    await datasets.refetch();
  };
  const remove = async () => {
    if (!datasetId) return;
    const response = await auth.authorizedFetch(`/api/evaluations/datasets/${datasetId}`, { method: 'DELETE' });
    if (!response.ok) throw new Error(await response.text());
    setDatasetId(undefined);
    setDeleteConfirm(false);
    resetRunView();
    await datasets.refetch();
  };
  const start = async () => {
    if (!datasetId) return;
    setError(undefined);
    setReportOpen(false);
    setSelectedResultId(undefined);
    setSelectedStage('rerank');
    setRun(await requestJson<Run>(auth.authorizedFetch, `/api/evaluations/datasets/${datasetId}/runs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode }) }));
  };
  const refreshRun = async () => {
    if (!run?.id) return;
    setError(undefined);
    setRun(await requestJson<Run>(auth.authorizedFetch, `/api/evaluations/runs/${run.id}`));
  };
  const safely = (action: () => Promise<void>) => void action().catch((reason) => setError(reason instanceof Error ? reason.message : '操作失败'));

  return <section className="space-y-5">
    <header className="flex items-start justify-between">
      <div><p className="text-sm font-medium text-blue-700">质量评测</p><h1 className="mt-1 font-sans text-3xl font-semibold leading-tight tracking-tight text-slate-950">评测中心</h1><p className="mt-2 text-sm text-slate-500">为固定的测试空间和题库重复运行，观察检索与回答质量的变化。</p></div>
      <Button variant="outline" onClick={() => setCreating((value) => !value)}><Plus size={16} />新建数据集</Button>
    </header>

    {creating ? <section className="grid grid-cols-[1fr_1fr_auto] gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><input className="h-9 rounded-md border border-slate-200 px-3 text-sm" placeholder="数据集名称，例如客服验收 V1" value={name} onChange={(event) => setName(event.target.value)} /><select className="h-9 rounded-md border border-slate-200 px-3 text-sm" value={spaceId} onChange={(event) => setSpaceId(event.target.value)}><option value="">选择测试知识空间</option>{(spaces.data ?? []).filter((item) => item.effectivePermission === 'MANAGE').map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><Button disabled={!name.trim() || !spaceId} onClick={() => safely(create)}>创建</Button></section> : null}

    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><label className="flex items-center gap-3 text-sm font-medium text-slate-700">当前数据集<select className="h-9 min-w-40 rounded-md border border-slate-200 bg-white px-3 text-sm font-normal text-slate-900" value={datasetId ?? ''} onChange={(event) => { restoredDatasetId.current = undefined; setDatasetId(event.target.value); resetRunView(); }}><option value="" disabled>请选择数据集</option>{(datasets.data?.datasets ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>{dataset.data ? <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-500">{dataset.data.cases.length} 道测试题</span> : null}</div>
      {dataset.data ? <><div className="grid grid-cols-3 gap-4 p-5 text-sm"><div className="rounded-lg border border-slate-100 bg-slate-50 p-4"><p className="font-medium text-slate-900">测试空间</p><p className="mt-3 font-medium text-slate-800">{space?.name ?? '空间不可访问'}</p><p className="mt-1 text-xs leading-5 text-slate-500">在这里维护用于测试的文档和解析结果。</p>{space ? <Link className="mt-3 inline-block text-sm font-medium text-blue-700 hover:text-blue-800" to={`/spaces/${space.id}`}>管理测试文件</Link> : null}</div><div className="rounded-lg border border-slate-100 bg-slate-50 p-4"><p className="font-medium text-slate-900">测试题目</p><p className="mt-3 font-medium text-slate-800">已有 {dataset.data.cases.length} 道题</p><p className="mt-1 text-xs leading-5 text-slate-500">导入新文件会先展示变更数量，再由你确认替换。</p><input ref={fileInput} className="hidden" type="file" accept=".jsonl,application/jsonl" onChange={(event) => { const file = event.target.files?.[0]; if (file) safely(() => chooseFile(file)); event.currentTarget.value = ''; }} /><Button className="mt-3" size="sm" variant="outline" disabled={run?.status === 'RUNNING'} onClick={() => fileInput.current?.click()}><FileUp size={15} />导入或替换题目</Button></div><div className="rounded-lg border border-blue-100 bg-blue-50/60 p-4"><p className="font-medium text-slate-900">运行评测</p><select className="mt-3 h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm" value={mode} onChange={(event) => setMode(event.target.value as Mode)}><option value="full">完整验收（含回答质量）</option><option value="retrieval">仅检索诊断</option></select><p className="mt-2 text-xs leading-5 text-slate-500">将逐题调用与聊天相同的检索和回答流程。</p><div className="mt-3 flex items-center gap-2"><Button disabled={!space || !dataset.data.cases.length || run?.status === 'RUNNING' || Boolean(pendingImport)} onClick={() => safely(start)}><Play size={15} />{run?.status === 'RUNNING' ? '评测运行中' : `运行 ${dataset.data.cases.length} 题`}</Button>{run ? <Button size="sm" variant="outline" onClick={() => safely(refreshRun)}><RefreshCw size={15} />刷新状态</Button> : null}</div>{run?.status === 'RUNNING' ? <p className="mt-3 text-xs font-medium text-blue-700">任务已在后台运行。题库和数据集已锁定，完成后可再修改。</p> : null}</div></div><div className="border-t border-slate-100 px-5 py-3"><Button className="text-red-700 hover:bg-red-50 hover:text-red-800" size="sm" variant="ghost" disabled={run?.status === 'RUNNING'} onClick={() => setDeleteConfirm(true)}><Trash2 size={15} />删除数据集</Button></div></> : <p className="p-5 text-sm text-slate-500">先新建一个数据集并绑定测试空间。</p>}
    </section>

    {pendingImport ? <section className="rounded-xl border border-amber-200 bg-amber-50 p-4"><p className="font-medium text-amber-950">确认替换题目</p><p className="mt-1 text-sm text-amber-900">“{pendingImport.fileName}”有 {pendingImport.incomingCaseCount} 道题，将替换当前 {pendingImport.existingCaseCount} 道题；历史运行结果会保留。</p><div className="mt-3 flex gap-2"><Button size="sm" disabled={run?.status === 'RUNNING'} onClick={() => safely(confirmImport)}>确认替换</Button><Button size="sm" variant="outline" onClick={() => setPendingImport(undefined)}>取消</Button></div>{run?.status === 'RUNNING' ? <p className="mt-2 text-sm text-amber-800">评测完成后才能替换题目。</p> : null}</section> : null}
    {deleteConfirm ? <section className="rounded-xl border border-red-200 bg-red-50 p-4"><p className="font-medium text-red-900">确认删除数据集</p><p className="mt-1 text-sm text-red-800">只删除题目和历史结果，不会删除绑定知识空间中的文件。</p><div className="mt-3 flex gap-2"><Button className="bg-red-600 hover:bg-red-700" size="sm" onClick={() => safely(remove)}>确认删除</Button><Button size="sm" variant="outline" onClick={() => setDeleteConfirm(false)}>取消</Button></div></section> : null}
    {run?.status === 'COMPLETED' && run.summary ? <section className="rounded-xl border border-slate-200 bg-white shadow-sm"><div className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><div><p className="font-medium text-slate-950">本次评测已完成</p><p className="mt-1 text-sm text-slate-500">{run.summary.completedCaseCount} 题完成{run.summary.failedCaseCount ? `，${run.summary.failedCaseCount} 题失败` : ''}。打开报告可查看每题和各检索阶段的明细。</p></div><Button variant="outline" onClick={() => setReportOpen(true)}>查看完整报告</Button></div><div className="grid grid-cols-4 divide-x divide-slate-100"><div className="p-4"><p className="text-sm text-slate-500">重排命中率（Top 10）</p><p className="mt-2 text-2xl font-semibold text-slate-950">{percentage(run.summary.stages.rerank.hitAt10)}</p></div><div className="p-4"><p className="text-sm text-slate-500">回答要点覆盖</p><p className="mt-2 text-2xl font-semibold text-slate-950">{percentage(run.summary.answerPointCoverage)}</p></div><div className="p-4"><p className="text-sm text-slate-500">引用证据准确率</p><p className="mt-2 text-2xl font-semibold text-slate-950">{percentage(run.summary.citationEvidencePrecision)}</p></div><div className="p-4"><p className="text-sm text-slate-500">平均耗时</p><p className="mt-2 text-2xl font-semibold text-slate-950">{Math.round(run.summary.averageElapsedMs)} ms</p></div></div></section> : null}
    {run?.status === 'FAILED' ? <section className="rounded-xl border border-red-200 bg-red-50 p-4"><p className="font-medium text-red-900">评测未完成</p><p className="mt-1 text-sm text-red-800">{run.error || '后台任务执行失败，请检查 AI 服务后重新运行。'}</p></section> : null}
    {error ? <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
    {reportVisible && run ? <EvaluationReportDrawer run={run} caseCount={dataset.data?.cases.length ?? run.results?.length ?? 0} selectedResultId={selectedResultId} selectedStage={selectedStage} onClose={() => setReportOpen(false)} onSelectResult={setSelectedResultId} onSelectStage={setSelectedStage} /> : null}
  </section>;
}
