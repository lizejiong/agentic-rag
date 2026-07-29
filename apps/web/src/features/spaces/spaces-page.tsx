import { useMemo, useState } from 'react';
import { ArrowRight, FolderKanban, Plus, Search, X } from 'lucide-react';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useAuth } from '@/features/auth/auth-provider';
import { createSpace } from './spaces-api';
import { useSpacesQuery, visibleSpacesQueryKey } from './use-spaces-query';

export function SpacesPage() {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const spacesQuery = useSpacesQuery(auth.authorizedFetch);
  const [keyword, setKeyword] = useState('');
  const [permission, setPermission] = useState('ALL');
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string>();
  const spaces = useMemo(() => (spacesQuery.data ?? []).filter((space) => (permission === 'ALL' || space.effectivePermission === permission) && `${space.name} ${space.description ?? ''}`.toLowerCase().includes(keyword.trim().toLowerCase())), [keyword, permission, spacesQuery.data]);
  const submit = async () => { if (!name.trim()) return; setError(undefined); try { await createSpace(auth.authorizedFetch, { name: name.trim(), ...(description.trim() ? { description: description.trim() } : {}) }); await queryClient.invalidateQueries({ queryKey: visibleSpacesQueryKey }); setCreating(false); setName(''); setDescription(''); } catch (cause) { setError(cause instanceof Error ? cause.message : '创建知识空间失败'); } };
  return <div className="space-y-7">
    <section className="flex items-start justify-between gap-6"><div><p className="text-sm font-medium text-blue-700">知识空间</p><h1 className="mt-2 text-2xl font-semibold tracking-tight">我的知识空间</h1><p className="mt-2 text-sm text-slate-500">进入空间后管理文档、权限和可验证的问答资料。</p></div>{auth.user?.role === 'ADMIN' ? <Button type="button" onClick={() => setCreating(true)}><Plus className="size-4" />创建知识空间</Button> : null}</section>
    <Card className="p-4"><div className="flex items-center gap-3"><label className="relative max-w-md flex-1"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" /><span className="sr-only">搜索知识空间</span><input className="h-9 w-full rounded-md border border-slate-200 pl-9 pr-3 text-sm outline-none focus:border-blue-500" placeholder="搜索空间名称或描述" value={keyword} onChange={(event) => setKeyword(event.target.value)} /></label><select className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-600" value={permission} onChange={(event) => setPermission(event.target.value)}><option value="ALL">全部权限</option><option value="MANAGE">可管理</option><option value="EDIT">可编辑</option><option value="VIEW">仅查看</option></select></div></Card>
    {creating ? <Card className="p-5"><div className="flex items-center justify-between"><h2 className="font-semibold">创建知识空间</h2><Button type="button" size="icon" variant="ghost" aria-label="关闭创建空间" onClick={() => setCreating(false)}><X className="size-4" /></Button></div><div className="mt-4 grid grid-cols-2 gap-4"><label className="text-sm text-slate-600">空间名称<input className="mt-2 h-9 w-full rounded-md border border-slate-200 px-3" value={name} onChange={(event) => setName(event.target.value)} /></label><label className="text-sm text-slate-600">空间描述（可选）<input className="mt-2 h-9 w-full rounded-md border border-slate-200 px-3" value={description} onChange={(event) => setDescription(event.target.value)} /></label></div>{error ? <p className="mt-3 text-sm text-red-600" role="alert">{error}</p> : null}<div className="mt-4 flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setCreating(false)}>取消</Button><Button type="button" disabled={!name.trim()} onClick={() => void submit()}>创建</Button></div></Card> : null}
    {spacesQuery.isPending ? <p className="text-sm text-slate-500">正在加载知识空间…</p> : null}{spacesQuery.isError ? <p className="text-sm text-red-600">知识空间加载失败，请稍后重试。</p> : null}
    {!spacesQuery.isPending && !spacesQuery.isError && spaces.length === 0 ? <p className="py-12 text-center text-sm text-slate-500">没有符合筛选条件的知识空间。</p> : null}
    <section className="grid grid-cols-3 gap-5" aria-label="知识空间列表">{spaces.map((space) => <Link key={space.id} to={`/spaces/${space.id}`}><Card className="h-full p-5 transition-shadow hover:shadow-md"><FolderKanban className="text-blue-700" size={22} /><h2 className="mt-5 text-base font-semibold">{space.name}</h2><p className="mt-2 min-h-10 text-sm text-slate-500">{space.description || '未填写空间描述。'}</p><div className="mt-5 flex items-center justify-between"><Badge>{space.documentCount} 份文档</Badge><span className="flex items-center gap-1 text-sm text-blue-700">进入空间 <ArrowRight size={15} /></span></div></Card></Link>)}</section>
  </div>;
}
