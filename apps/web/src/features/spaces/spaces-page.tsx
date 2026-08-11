import { useMemo, useState } from 'react';

import { ArrowRight, FolderKanban, Plus, Search, Trash2 } from 'lucide-react';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { SidePanel } from '@/components/ui/side-panel';
import { useAuth } from '@/features/auth/auth-provider';

import { createSpace, deleteSpace } from './spaces-api';
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
  const [deletingId, setDeletingId] = useState<string>();
  const spaces = useMemo(
    () =>
      (spacesQuery.data ?? []).filter(
        (space) =>
          (permission === 'ALL' || space.effectivePermission === permission) &&
          `${space.name} ${space.description ?? ''}`.toLowerCase().includes(keyword.trim().toLowerCase()),
      ),
    [keyword, permission, spacesQuery.data],
  );

  const closeCreate = () => {
    setCreating(false);
    setName('');
    setDescription('');
    setError(undefined);
  };
  const submit = async () => {
    if (!name.trim()) return;
    setError(undefined);
    try {
      await createSpace(auth.authorizedFetch, {
        name: name.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
      });
      await queryClient.invalidateQueries({ queryKey: visibleSpacesQueryKey });
      closeCreate();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '创建知识空间失败');
    }
  };
  const remove = async (spaceId: string, spaceName: string) => {
    if (!window.confirm(`确定删除“${spaceName}”吗？删除后空间将不再可访问。`)) return;
    setDeletingId(spaceId);
    setError(undefined);
    try {
      await deleteSpace(auth.authorizedFetch, spaceId);
      await queryClient.invalidateQueries({ queryKey: visibleSpacesQueryKey });
      await spacesQuery.refetch();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '删除知识空间失败');
    } finally {
      setDeletingId(undefined);
    }
  };

  return (
    <div className="space-y-7">
      <section className="flex items-start justify-between gap-6">
        <div>
          <p className="text-sm font-medium text-blue-700">知识空间</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">我的知识空间</h1>
          <p className="mt-2 text-sm text-slate-500">进入空间后管理文档、权限和可验证的问答资料。</p>
        </div>
        {auth.user?.role === 'ADMIN' ? (
          <Button onClick={() => setCreating(true)} type="button"><Plus className="size-4" />创建知识空间</Button>
        ) : null}
      </section>
      <Card className="p-4">
        <div className="flex items-center gap-3">
          <label className="relative max-w-md flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <span className="sr-only">搜索知识空间</span>
            <input className="h-9 w-full rounded-md border border-slate-200 pl-9 pr-3 text-sm outline-none focus:border-blue-500" onChange={(event) => setKeyword(event.target.value)} placeholder="搜索空间名称或描述" value={keyword} />
          </label>
          <select className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-600" onChange={(event) => setPermission(event.target.value)} value={permission}>
            <option value="ALL">全部权限</option><option value="MANAGE">可管理</option><option value="EDIT">可编辑</option><option value="VIEW">仅查看</option>
          </select>
        </div>
      </Card>
      {error ? <p className="text-sm text-red-600" role="alert">{error}</p> : null}
      {spacesQuery.isPending ? <p className="text-sm text-slate-500">正在加载知识空间…</p> : null}
      {spacesQuery.isError ? <p className="text-sm text-red-600">知识空间加载失败，请稍后重试。</p> : null}
      {!spacesQuery.isPending && !spacesQuery.isError && spaces.length === 0 ? <p className="py-12 text-center text-sm text-slate-500">没有符合筛选条件的知识空间。</p> : null}
      <section aria-label="知识空间列表" className="grid grid-cols-3 gap-5">
        {spaces.map((space) => (
          <Card className="flex h-full flex-col p-5 transition-shadow hover:shadow-md" key={space.id}>
            <div className="flex items-start justify-between gap-3"><FolderKanban className="text-blue-700" size={22} />
              {auth.user?.role === 'ADMIN' ? <Button aria-label={`删除 ${space.name}`} className="text-red-700 hover:bg-red-50 hover:text-red-800" disabled={deletingId === space.id} onClick={() => void remove(space.id, space.name)} size="icon" type="button" variant="ghost"><Trash2 className="size-4" /></Button> : null}
            </div>
            <Link className="mt-5 block" to={`/spaces/${space.id}`}><h2 className="text-base font-semibold">{space.name}</h2><p className="mt-2 min-h-10 text-sm text-slate-500">{space.description || '未填写空间描述。'}</p></Link>
            <Link className="mt-5 flex items-center justify-between" to={`/spaces/${space.id}`}><Badge>{space.documentCount} 份文档</Badge><span className="flex items-center gap-1 text-sm text-blue-700">进入空间 <ArrowRight size={15} /></span></Link>
          </Card>
        ))}
      </section>
      <SidePanel onClose={closeCreate} open={creating} title="创建知识空间">
        <div className="space-y-5">
          <label className="block text-sm text-slate-600">空间名称<input autoFocus className="mt-2 h-9 w-full rounded-md border border-slate-200 px-3" onChange={(event) => setName(event.target.value)} value={name} /></label>
          <label className="block text-sm text-slate-600">空间描述（可选）<textarea className="mt-2 min-h-24 w-full rounded-md border border-slate-200 px-3 py-2" onChange={(event) => setDescription(event.target.value)} value={description} /></label>
          {error ? <p className="text-sm text-red-600" role="alert">{error}</p> : null}
          <div className="flex justify-end gap-2"><Button onClick={closeCreate} type="button" variant="outline">取消</Button><Button disabled={!name.trim()} onClick={() => void submit()} type="button">创建</Button></div>
        </div>
      </SidePanel>
    </div>
  );
}
