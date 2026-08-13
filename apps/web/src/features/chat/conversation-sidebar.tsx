import { useState } from 'react';

import { Archive, Pencil, Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';

import type { ConversationSummary } from './chat-api';

export function ConversationSidebar({
  conversations, activeId, creating, onCreate, onSelect, onRename, onArchive,
}: {
  conversations: ConversationSummary[];
  activeId: string | undefined;
  creating: boolean;
  onCreate: () => void;
  onSelect: (conversationId: string) => void;
  onRename: (conversationId: string, title: string) => void;
  onArchive: (conversationId: string) => void;
}) {
  const [editing, setEditing] = useState<string>();
  const [title, setTitle] = useState('');
  return <aside className="flex w-60 shrink-0 flex-col border-r border-slate-200 bg-slate-50/70 p-3">
    <div className="px-2 pb-3"><p className="text-sm font-semibold text-slate-900">会话记录</p><p className="mt-1 text-xs text-slate-500">跨设备保存聊天记录</p></div>
    <Button type="button" variant="outline" className="w-full justify-start" onClick={onCreate} disabled={creating}><Plus className="size-4" aria-hidden="true" />新建会话</Button>
    <div className="mt-4 space-y-1 overflow-y-auto">
      {conversations.map((conversation) => {
        const active = conversation.id === activeId;
        const isEditing = editing === conversation.id;
        return <div className={`group rounded-lg border ${active ? 'border-blue-100 bg-blue-50' : 'border-transparent hover:border-slate-200 hover:bg-white'}`} key={conversation.id}>
          {isEditing ? <form className="flex gap-1 p-1" onSubmit={(event) => { event.preventDefault(); const next = title.trim(); if (!next) return; onRename(conversation.id, next); setEditing(undefined); }}><input aria-label="会话标题" autoFocus className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1 text-sm" maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} /><Button size="sm" type="submit">保存</Button></form> : <div className="flex items-center gap-1"><button type="button" onClick={() => onSelect(conversation.id)} className={`min-w-0 flex-1 px-3 py-2.5 text-left text-sm font-medium ${active ? 'text-blue-800' : 'text-slate-700'}`}><span className="block truncate">{conversation.title}</span></button><div className="hidden pr-1 group-hover:flex"><button aria-label="重命名" className="rounded p-1 text-slate-500 hover:bg-white" onClick={() => { setEditing(conversation.id); setTitle(conversation.title); }}><Pencil className="size-3.5" /></button><button aria-label="归档" className="rounded p-1 text-slate-500 hover:bg-white" onClick={() => onArchive(conversation.id)}><Archive className="size-3.5" /></button></div></div>}
        </div>;
      })}
    </div>
    <p className="mt-auto px-2 pb-1 text-xs leading-5 text-slate-500">内容仅来自你当前有访问权限的知识空间。</p>
  </aside>;
}
