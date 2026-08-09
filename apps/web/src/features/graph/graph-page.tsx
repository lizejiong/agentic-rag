import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Network, RefreshCw } from 'lucide-react';
import { Link, Navigate, useParams } from 'react-router';
import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { useAuth } from '@/features/auth/auth-provider';
import { useSpacesQuery } from '@/features/spaces/use-spaces-query';

import {
  correctGraphRelation,
  findGraphPaths,
  type GraphRelation,
  listGraphRelations,
  mergeGraphEntities,
  publishGraphRelation,
  rejectGraphRelation,
  rollbackGraphRelation,
  splitGraphEntity,
} from './graph-api';

export function GraphPage() {
  const { spaceId = '' } = useParams();
  const auth = useAuth();
  const client = useQueryClient();
  const spaces = useSpacesQuery(auth.authorizedFetch);
  const canManage = spaces.data?.find((space) => space.id === spaceId)?.effectivePermission === 'MANAGE';
  const [query, setQuery] = useState('');
  const [sourceId, setSourceId] = useState('');
  const [targetId, setTargetId] = useState('');
  const published = useQuery({
    queryKey: ['graph', spaceId, 'PUBLISHED', query],
    queryFn: () => listGraphRelations(auth.authorizedFetch, spaceId, 'PUBLISHED', query),
    enabled: Boolean(spaceId),
  });
  const candidates = useQuery({
    queryKey: ['graph', spaceId, 'PENDING_REVIEW', query],
    queryFn: () => listGraphRelations(auth.authorizedFetch, spaceId, 'PENDING_REVIEW', query),
    enabled: Boolean(spaceId) && Boolean(canManage),
  });
  const invalidate = () => void client.invalidateQueries({ queryKey: ['graph', spaceId] });
  const publish = useMutation({ mutationFn: (relationId: string) => publishGraphRelation(auth.authorizedFetch, spaceId, relationId), onSuccess: invalidate });
  const reject = useMutation({ mutationFn: (relationId: string) => rejectGraphRelation(auth.authorizedFetch, spaceId, relationId), onSuccess: invalidate });
  const correct = useMutation({ mutationFn: ({ relationId, predicate }: { relationId: string; predicate: string }) => correctGraphRelation(auth.authorizedFetch, spaceId, relationId, predicate), onSuccess: invalidate });
  const rollback = useMutation({ mutationFn: (relationId: string) => rollbackGraphRelation(auth.authorizedFetch, spaceId, relationId), onSuccess: invalidate });
  const merge = useMutation({ mutationFn: ({ source, target }: { source: string; target: string }) => mergeGraphEntities(auth.authorizedFetch, spaceId, source, target), onSuccess: invalidate });
  const split = useMutation({ mutationFn: ({ source, name, entityType, relationIds }: { source: string; name: string; entityType: string; relationIds: string[] }) => splitGraphEntity(auth.authorizedFetch, spaceId, source, { name, entityType, relationIds }), onSuccess: invalidate });
  const paths = useMutation({ mutationFn: () => findGraphPaths(auth.authorizedFetch, spaceId, sourceId, targetId) });

  if (!spaceId) return <Navigate replace to="/spaces" />;
  const allRelations = [...(published.data?.relations ?? []), ...(candidates.data?.relations ?? [])];
  return <div className="space-y-6">
    <p className="text-sm text-slate-500"><Link to={`/spaces/${spaceId}`} className="hover:text-blue-700">知识空间</Link> / 知识图谱</p>
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between gap-4"><div><p className="flex items-center gap-2 text-sm font-medium text-blue-700"><Network size={17} /> 可追溯证据的知识图谱</p><h1 className="mt-2 text-2xl font-semibold">已发布关系</h1><p className="mt-2 text-sm text-slate-500">每条展示的关系都关联当前可访问的原始文档证据。</p></div><Button variant="outline" onClick={() => { void published.refetch(); void candidates.refetch(); }}><RefreshCw size={15} />刷新</Button></div>
      <input className="mt-5 h-10 w-full rounded-md border border-slate-200 px-3 text-sm" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索实体或关系" />
    </section>
    <RelationList relations={published.data?.relations ?? []} empty="暂无已发布关系。" canManage={Boolean(canManage)} correct={correct.mutate} rollback={rollback.mutate} />
    <PathExplorer relations={published.data?.relations ?? []} sourceId={sourceId} targetId={targetId} setSourceId={setSourceId} setTargetId={setTargetId} find={() => paths.mutate()} paths={paths.data?.paths ?? []} />
    {canManage ? <>
      <section className="space-y-3"><h2 className="text-lg font-semibold">候选关系审核</h2><RelationList relations={candidates.data?.relations ?? []} empty="暂无待审核候选关系。" publish={publish.mutate} reject={reject.mutate} /></section>
      <GovernancePanel relations={allRelations} onMerge={merge.mutate} onSplit={split.mutate} />
    </> : null}
  </div>;
}

function PathExplorer({ relations, sourceId, targetId, setSourceId, setTargetId, find, paths }: { relations: GraphRelation[]; sourceId: string; targetId: string; setSourceId: (value: string) => void; setTargetId: (value: string) => void; find: () => void; paths: GraphRelation[][] }) {
  const entities = useEntities(relations);
  if (entities.length < 2) return null;
  return <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="font-semibold text-slate-900">关系路径</h2><p className="mt-1 text-sm text-slate-500">查找最多三跳的关系路径；每条边均须保留当前可访问的证据。</p><div className="mt-4 flex flex-wrap items-center gap-3"><EntitySelect entities={entities} value={sourceId} onChange={setSourceId} placeholder="起始实体" /><EntitySelect entities={entities} value={targetId} onChange={setTargetId} placeholder="目标实体" /><Button size="sm" disabled={!sourceId || !targetId || sourceId === targetId} onClick={find}>查找路径</Button></div>{paths.map((path, index) => <p className="mt-3 rounded bg-slate-50 p-3 text-sm text-slate-700" key={`${path.map((relation) => relation.id).join('-')}-${index}`}>{path.map((relation) => `${relation.subject} —${relation.predicate}→ ${relation.object}`).join('；')}</p>)}</section>;
}

function GovernancePanel({ relations, onMerge, onSplit }: { relations: GraphRelation[]; onMerge: (input: { source: string; target: string }) => void; onSplit: (input: { source: string; name: string; entityType: string; relationIds: string[] }) => void }) {
  const entities = useEntities(relations);
  const [source, setSource] = useState('');
  const [target, setTarget] = useState('');
  const [splitName, setSplitName] = useState('');
  const [splitType, setSplitType] = useState('概念');
  const [selectedRelations, setSelectedRelations] = useState<string[]>([]);
  const sourceRelations = relations.filter((relation) => relation.subjectEntityId === source || relation.objectEntityId === source);
  const toggleRelation = (relationId: string) => setSelectedRelations((current) => current.includes(relationId) ? current.filter((id) => id !== relationId) : [...current, relationId]);
  return <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="font-semibold text-slate-900">治理操作</h2><p className="mt-1 text-sm text-slate-500">人工改动会记录为修订；再次发布后，关系才会进入已发布图谱。</p><div className="mt-4 grid gap-5 lg:grid-cols-2"><div className="space-y-3 rounded-lg bg-slate-50 p-4"><h3 className="font-medium">合并实体</h3><EntitySelect entities={entities} value={source} onChange={(value) => { setSource(value); setSelectedRelations([]); }} placeholder="待合并实体" /><EntitySelect entities={entities} value={target} onChange={setTarget} placeholder="合并到" /><Button size="sm" disabled={!source || !target || source === target} onClick={() => onMerge({ source, target })}>合并</Button></div><div className="space-y-3 rounded-lg bg-slate-50 p-4"><h3 className="font-medium">拆分实体</h3><EntitySelect entities={entities} value={source} onChange={(value) => { setSource(value); setSelectedRelations([]); }} placeholder="源实体" /><input className="h-9 w-full rounded-md border border-slate-200 px-2 text-sm" value={splitName} onChange={(event) => setSplitName(event.target.value)} placeholder="新实体名称" /><input className="h-9 w-full rounded-md border border-slate-200 px-2 text-sm" value={splitType} onChange={(event) => setSplitType(event.target.value)} placeholder="新实体类型" />{sourceRelations.map((relation) => <label className="flex items-center gap-2 text-sm" key={relation.id}><input type="checkbox" checked={selectedRelations.includes(relation.id)} onChange={() => toggleRelation(relation.id)} />{relation.subject} —{relation.predicate}→ {relation.object}</label>)}<Button size="sm" disabled={!source || !splitName.trim() || !splitType.trim() || !selectedRelations.length} onClick={() => onSplit({ source, name: splitName.trim(), entityType: splitType.trim(), relationIds: selectedRelations })}>拆分所选关系</Button></div></div></section>;
}

function EntitySelect({ entities, value, onChange, placeholder }: { entities: Array<[string, string]>; value: string; onChange: (value: string) => void; placeholder: string }) {
  return <select className="h-9 max-w-full rounded-md border border-slate-200 px-2 text-sm" value={value} onChange={(event) => onChange(event.target.value)}><option value="">{placeholder}</option>{entities.map(([id, name]) => <option value={id} key={id}>{name}</option>)}</select>;
}

function useEntities(relations: GraphRelation[]) {
  return useMemo(() => Array.from(new Map(relations.flatMap((relation) => [[relation.subjectEntityId, relation.subject], [relation.objectEntityId, relation.object]])).entries()), [relations]);
}

function RelationList({ relations, empty, publish, reject, canManage, correct, rollback }: { relations: GraphRelation[]; empty: string; publish?: (id: string) => void; reject?: (id: string) => void; canManage?: boolean; correct?: (input: { relationId: string; predicate: string }) => void; rollback?: (id: string) => void }) {
  if (!relations.length) return <p className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-sm text-slate-500">{empty}</p>;
  return <div className="space-y-3">{relations.map((relation) => <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm" key={relation.id}><div className="flex flex-wrap items-center justify-between gap-4"><p className="font-medium text-slate-900">{relation.subject} <span className="mx-2 text-blue-700">{relation.predicate}</span> {relation.object}</p>{publish ? <span className="flex gap-2"><Button size="sm" onClick={() => publish(relation.id)}><CheckCircle2 size={15} />发布</Button><Button size="sm" variant="outline" onClick={() => reject?.(relation.id)}>驳回</Button></span> : null}{canManage ? <span className="flex gap-2"><Button size="sm" variant="outline" onClick={() => { const predicate = window.prompt('请输入新的关系类型', relation.predicate); if (predicate?.trim()) correct?.({ relationId: relation.id, predicate: predicate.trim() }); }}>纠错</Button><Button size="sm" variant="outline" onClick={() => rollback?.(relation.id)}>回滚</Button></span> : null}</div><p className="mt-2 text-xs text-slate-500">{relation.subjectType} · {relation.objectType} · 置信度 {relation.confidence ?? '—'}</p>{relation.evidence.map((evidence) => <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm" key={evidence.chunkId}><Link className="font-medium text-blue-700 hover:text-blue-800" to={`/documents/${evidence.documentId}`}>{evidence.title}</Link><p className="mt-1 text-slate-600">{evidence.quote}</p></div>)}</article>)}</div>;
}
