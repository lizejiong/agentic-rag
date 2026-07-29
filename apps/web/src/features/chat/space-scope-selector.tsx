import { useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { VisibleSpace } from '../spaces/space-contract';

export function SpaceScopeSelector({ spaces, selectedIds, loading, onChange }: { spaces: VisibleSpace[]; selectedIds: string[]; loading: boolean; onChange: (ids: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const selectedCount = selectedIds.length;
  const selectedName = spaces.find((space) => space.id === selectedIds[0])?.name;
  const label = loading ? '正在加载知识范围' : selectedCount === spaces.length && spaces.length > 0 ? '全部可访问空间' : selectedCount === 1 ? selectedName : selectedCount > 1 ? `已选 ${selectedCount} 个空间` : '请选择知识空间';
  return (
    <div className="relative">
      <Button type="button" variant="outline" className="min-w-52 justify-between font-normal" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span className="truncate">{label}</span><ChevronDown className="size-4 text-slate-400" aria-hidden="true" />
      </Button>
      {open ? <div className="absolute right-0 z-20 mt-2 w-80 rounded-lg border border-slate-200 bg-white p-3 shadow-lg">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3"><div><p className="text-sm font-semibold text-slate-900">知识范围</p><p className="mt-0.5 text-xs text-slate-500">仅检索你有权限访问的空间</p></div><Button type="button" size="sm" variant="ghost" disabled={loading || spaces.length === 0} onClick={() => onChange(spaces.map((space) => space.id))}>全选</Button></div>
        <div className="max-h-64 space-y-1 overflow-y-auto py-2">
          {loading ? <p className="px-2 py-4 text-sm text-slate-500">正在加载空间…</p> : null}
          {!loading && spaces.length === 0 ? <p className="px-2 py-4 text-sm text-slate-500">当前没有可访问的知识空间。</p> : null}
          {spaces.map((space) => { const checked = selectedIds.includes(space.id); return <label key={space.id} className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 hover:bg-slate-50"><input type="checkbox" checked={checked} onChange={() => onChange(checked ? selectedIds.filter((id) => id !== space.id) : [...selectedIds, space.id])} className="sr-only" /><span className={`flex size-4 items-center justify-center rounded border ${checked ? 'border-blue-700 bg-blue-700 text-white' : 'border-slate-300 bg-white'}`} aria-hidden="true">{checked ? <Check className="size-3" /> : null}</span><span className="min-w-0 flex-1"><span className="block truncate text-sm text-slate-700">{space.name}</span><span className="text-xs text-slate-400">{space.documentCount} 篇文档</span></span></label>; })}
        </div>
      </div> : null}
    </div>
  );
}
