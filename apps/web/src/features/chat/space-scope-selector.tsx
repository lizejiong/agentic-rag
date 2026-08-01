import { useEffect, useMemo, useState } from 'react';
import { Check, Database, Search, SlidersHorizontal, X } from 'lucide-react';

import { Button } from '@/components/ui/button';

import type { VisibleSpace } from '../spaces/space-contract';

export function SpaceScopeSelector({ spaces, selectedIds, loading, onChange }: { spaces: VisibleSpace[]; selectedIds: string[]; loading: boolean; onChange: (ids: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [draftIds, setDraftIds] = useState(selectedIds);
  useEffect(() => { if (open) setDraftIds(selectedIds); }, [open, selectedIds]);

  const filteredSpaces = useMemo(() => spaces.filter((space) => space.name.toLowerCase().includes(keyword.trim().toLowerCase())), [keyword, spaces]);
  const selectedName = spaces.find((space) => space.id === selectedIds[0])?.name;
  const label = loading ? '加载范围中' : selectedIds.length === spaces.length && spaces.length > 0 ? '全部空间' : selectedIds.length === 1 ? selectedName : selectedIds.length > 1 ? `已选 ${selectedIds.length} 个` : '选择空间';
  const apply = () => { onChange(draftIds); setOpen(false); };

  return <>
    <Button aria-expanded={open} className="h-8 max-w-48 justify-start rounded-md border-slate-200 bg-slate-50 px-2.5 font-normal text-slate-600 hover:bg-slate-100" onClick={() => setOpen(true)} size="sm" type="button" variant="outline">
      <Database aria-hidden="true" className="size-3.5 text-blue-700" />
      <span className="truncate">{label}</span>
      <SlidersHorizontal aria-hidden="true" className="ml-auto size-3.5 text-slate-400" />
    </Button>
    {open ? <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-label="管理知识范围" aria-modal="true">
      <button aria-label="关闭知识范围管理" className="absolute inset-0 bg-slate-950/20" onClick={() => setOpen(false)} type="button" />
      <section className="relative flex h-full w-[420px] flex-col bg-white shadow-2xl">
        <header className="flex items-start justify-between border-b border-slate-200 px-6 py-5">
          <div><h2 className="text-base font-semibold text-slate-900">管理检索范围</h2><p className="mt-1 text-sm text-slate-500">仅搜索你当前有权限访问的知识空间。</p></div>
          <Button aria-label="关闭知识范围管理" onClick={() => setOpen(false)} size="icon" type="button" variant="ghost"><X className="size-4" /></Button>
        </header>
        <div className="border-b border-slate-100 px-6 py-4">
          <label className="flex h-10 items-center gap-2 rounded-lg border border-slate-200 px-3 text-slate-400"><Search className="size-4" /><span className="sr-only">搜索知识空间</span><input autoFocus className="min-w-0 flex-1 text-sm text-slate-700 outline-none placeholder:text-slate-400" onChange={(event) => setKeyword(event.target.value)} placeholder="搜索知识空间" value={keyword} /></label>
          <div className="mt-3 flex items-center justify-between text-sm"><span className="text-slate-500">已选择 {draftIds.length} 个空间</span><div><Button disabled={loading || spaces.length === 0} onClick={() => setDraftIds([])} size="sm" type="button" variant="ghost">清空</Button><Button disabled={loading || spaces.length === 0} onClick={() => setDraftIds(spaces.map((space) => space.id))} size="sm" type="button" variant="ghost">全选</Button></div></div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {loading ? <p className="px-2 py-5 text-sm text-slate-500">正在加载空间…</p> : null}
          {!loading && filteredSpaces.length === 0 ? <p className="px-2 py-5 text-sm text-slate-500">没有符合条件的知识空间。</p> : null}
          {filteredSpaces.map((space) => { const checked = draftIds.includes(space.id); return <label key={space.id} className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-3 hover:bg-slate-50"><input checked={checked} className="sr-only" onChange={() => setDraftIds((current) => checked ? current.filter((id) => id !== space.id) : [...current, space.id])} type="checkbox" /><span className={`flex size-4 items-center justify-center rounded border ${checked ? 'border-blue-700 bg-blue-700 text-white' : 'border-slate-300 bg-white'}`} aria-hidden="true">{checked ? <Check className="size-3" /> : null}</span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-slate-700">{space.name}</span><span className="mt-0.5 block text-xs text-slate-400">{space.documentCount} 篇文档</span></span></label>; })}
        </div>
        <footer className="flex justify-end gap-3 border-t border-slate-200 px-6 py-4"><Button onClick={() => setOpen(false)} type="button" variant="outline">取消</Button><Button onClick={apply} type="button">应用范围</Button></footer>
      </section>
    </div> : null}
  </>;
}
