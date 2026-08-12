import { useMemo, useRef, useState } from 'react';

import { FileText, Globe2, Search, Trash2, Upload } from 'lucide-react';
import { Navigate, useParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { SidePanel } from '@/components/ui/side-panel';
import { useAuth } from '@/features/auth/auth-provider';
import { SpaceTabs } from '@/features/spaces/space-tabs';
import { useSpacesQuery } from '@/features/spaces/use-spaces-query';

import { DocumentDetailPanel } from './document-detail-panel';
import { deleteDocument, downloadDocument, replaceFile, uploadFile, waitForImport } from './documents-api';
import { DocumentUploadPanel } from './document-upload-panel';
import { DocumentUrlImportPanel } from './document-url-import-panel';
import { useDocumentsQuery } from './use-documents-query';

const statusOptions = [{ value: '', label: '全部状态' }, { value: 'READY', label: '已就绪' }, { value: 'FAILED', label: '失败' }, { value: 'QUEUED', label: '处理中' }];
const typeLabel = (mimeType: string | null | undefined) => mimeType?.split('/').at(-1)?.toUpperCase() ?? '文件';

export function DocumentListPage() {
  const { spaceId = '' } = useParams();
  const auth = useAuth();
  const client = useQueryClient();
  const spacesQuery = useSpacesQuery(auth.authorizedFetch);
  const selectedSpace = spacesQuery.data?.find((space) => space.id === spaceId);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [showUpload, setShowUpload] = useState(false);
  const [showUrlImport, setShowUrlImport] = useState(false);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [replacingId, setReplacingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string>();
  const replaceInput = useRef<HTMLInputElement>(null);
  const documentsQuery = useDocumentsQuery(auth.authorizedFetch, spaceId, { search, status: statusFilter });
  const canEdit = selectedSpace?.effectivePermission === 'EDIT' || selectedSpace?.effectivePermission === 'MANAGE';
  const documents = useMemo(() => (documentsQuery.data ?? []).filter((document) => !typeFilter || document.latestVersion?.declaredMimeType === typeFilter), [documentsQuery.data, typeFilter]);
  const documentTypes = useMemo(() => [...new Set((documentsQuery.data ?? []).map((document) => document.latestVersion?.declaredMimeType).filter(Boolean))] as string[], [documentsQuery.data]);
  const allSelected = documents.length > 0 && documents.every((document) => selectedIds.includes(document.id));
  const refreshDocuments = async (documentId?: string) => {
    await client.invalidateQueries({ queryKey: ['spaces', spaceId, 'documents'] });
    if (documentId) await client.invalidateQueries({ queryKey: ['document', documentId] });
    await documentsQuery.refetch();
  };
  const toggleSelection = (id: string) => setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const toggleAll = () => setSelectedIds(allSelected ? [] : documents.map((document) => document.id));
  const handleDownload = async (documentId: string, fileName: string | undefined) => {
    if (!fileName) return;
    try { await downloadDocument(auth.authorizedFetch, documentId, fileName); } catch (caught) { setError(caught instanceof Error ? caught.message : '下载文档失败'); }
  };
  const handleReplace = async (file: File) => {
    if (!replacingId) return;
    const documentId = replacingId;
    try {
      const ticket = await replaceFile(auth.authorizedFetch, documentId, { fileName: file.name, sizeBytes: file.size, mimeType: file.type || 'application/octet-stream' });
      const token = auth.getAccessToken() ?? await auth.refreshAccessToken();
      if (!token) throw new Error('AUTH_SESSION_EXPIRED');
      await uploadFile({ clientFileId: crypto.randomUUID(), ...ticket }, file, token, () => {});
      await waitForImport(auth.authorizedFetch, ticket.importId);
      await refreshDocuments(documentId);
    } catch (caught) { setError(caught instanceof Error ? caught.message : '替换文档失败'); } finally { setReplacingId(null); if (replaceInput.current) replaceInput.current.value = ''; }
  };
  const remove = async (ids: string[]) => {
    if (!ids.length || !window.confirm(`确定删除选中的 ${ids.length} 份文档吗？`)) return;
    setDeleting(true); setError(undefined);
    const results = await Promise.allSettled(ids.map((id) => deleteDocument(auth.authorizedFetch, id)));
    const failed = results.flatMap((result, index) => result.status === 'rejected' && ids[index] ? [ids[index]] : []);
    setSelectedIds(failed);
    if (failed.length) setError(`${failed.length} 份文档删除失败，请重试。`);
    await refreshDocuments();
    setDeleting(false);
  };
  if (!spaceId) return <Navigate replace to="/spaces" />;
  return <div className="space-y-7">
    <SpaceTabs canManage={selectedSpace?.effectivePermission === 'MANAGE'} spaceId={spaceId} spaceName={selectedSpace?.name} />
    {error ? <p className="text-sm text-red-600" role="alert">{error}</p> : null}
    <section aria-label="文档列表">
      <div className="mb-4 flex items-center justify-between gap-4"><div className="flex flex-1 items-center gap-3"><label className="relative max-w-md flex-1"><Search aria-hidden="true" className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" /><span className="sr-only">搜索文档名称</span><input className="h-9 w-full rounded-md border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-blue-500" onChange={(event) => setSearch(event.target.value)} placeholder="搜索文档名称" type="search" value={search} /></label><select className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-600" onChange={(event) => setTypeFilter(event.target.value)} value={typeFilter}><option value="">全部类型</option>{documentTypes.map((type) => <option key={type} value={type}>{typeLabel(type)}</option>)}</select><select className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-600" onChange={(event) => setStatusFilter(event.target.value)} value={statusFilter}>{statusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>{canEdit ? <div className="flex items-center gap-2"><Button onClick={() => setShowUrlImport(true)} type="button" variant="outline"><Globe2 size={16} />导入网页</Button><Button onClick={() => setShowUpload(true)} type="button"><Upload size={16} />上传文档</Button></div> : null}</div>
      {canEdit && selectedIds.length ? <div className="mb-3 flex justify-end"><Button className="border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800" disabled={deleting} onClick={() => void remove(selectedIds)} type="button" variant="outline"><Trash2 size={16} />批量删除（{selectedIds.length}）</Button></div> : null}
      <Card className="overflow-hidden"><table className="w-full table-fixed border-collapse text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr>{canEdit ? <th className="w-12 px-4 py-3"><input aria-label="全选文档" checked={allSelected} onChange={toggleAll} type="checkbox" /></th> : null}<th className="w-[34%] px-4 py-3 font-medium">文档名称</th><th className="w-[13%] px-3 py-3 font-medium">来源</th><th className="w-[12%] px-3 py-3 font-medium">状态</th><th className="w-[16%] px-3 py-3 font-medium">更新时间</th><th className="px-4 py-3 text-right font-medium">操作</th></tr></thead><tbody className="divide-y divide-slate-100">
        {documentsQuery.isPending ? <tr><td className="px-5 py-10 text-center text-slate-500" colSpan={canEdit ? 6 : 5}>正在加载文档…</td></tr> : null}
        {!documentsQuery.isPending && documents.length === 0 ? <tr><td className="px-5 py-10 text-center text-slate-500" colSpan={canEdit ? 6 : 5}>当前筛选条件下没有文档。</td></tr> : null}
        {documents.map((document) => { const status = document.latestVersion?.processingStatus ?? 'PENDING_UPLOAD'; const ready = status === 'READY'; return <tr className="hover:bg-slate-50" key={document.id}>{canEdit ? <td className="px-4 py-4"><input aria-label={`选择 ${document.title}`} checked={selectedIds.includes(document.id)} onChange={() => toggleSelection(document.id)} type="checkbox" /></td> : null}<td className="px-4 py-4"><button className="flex max-w-full items-center gap-3 text-left" onClick={() => setSelectedDocumentId(document.id)} type="button"><span className="grid size-8 place-items-center rounded-md bg-blue-50 text-blue-700"><FileText size={17} /></span><span className="min-w-0"><span className="block truncate font-medium text-slate-800">{document.title}</span><span className="mt-1 block text-xs text-slate-400">{typeLabel(document.latestVersion?.declaredMimeType)}</span></span></button></td><td className="px-3 py-4 text-slate-500">{document.sourceType === 'URL' ? '网页导入' : '文件上传'}</td><td className="px-3 py-4"><Badge className={ready ? 'bg-emerald-50 text-emerald-700' : status === 'FAILED' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}>{ready ? '已就绪' : status === 'FAILED' ? '失败' : '处理中'}</Badge></td><td className="px-3 py-4 text-slate-500">{new Date(document.updatedAt).toLocaleString('zh-CN')}</td><td className="px-4 py-4"><div className="flex justify-end gap-1"><Button onClick={() => setSelectedDocumentId(document.id)} size="sm" type="button" variant="ghost">查看</Button>{canEdit ? <><Button disabled={!ready || !document.latestVersion?.originalFileName} onClick={() => void handleDownload(document.id, document.latestVersion?.originalFileName)} size="sm" type="button" variant="ghost">下载</Button><Button disabled={replacingId === document.id} onClick={() => { setReplacingId(document.id); replaceInput.current?.click(); }} size="sm" type="button" variant="ghost">替换</Button><Button className="text-red-700 hover:bg-red-50 hover:text-red-800" disabled={deleting} onClick={() => void remove([document.id])} size="sm" type="button" variant="ghost">删除</Button></> : null}</div></td></tr>; })}
      </tbody></table></Card>
    </section>
    <input accept=".pdf,.docx,.doc,.xlsx,.xls,.pptx,.ppt,.txt,.md,.csv,.json" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) void handleReplace(file); }} ref={replaceInput} type="file" />
    <SidePanel onClose={() => setShowUpload(false)} open={showUpload} title="上传文档"><DocumentUploadPanel fetcher={auth.authorizedFetch} getAccessToken={auth.getAccessToken} onQueued={() => refreshDocuments()} refreshAccessToken={auth.refreshAccessToken} spaceId={spaceId} /></SidePanel>
    <SidePanel onClose={() => setShowUrlImport(false)} open={showUrlImport} title="导入网页"><DocumentUrlImportPanel fetcher={auth.authorizedFetch} onQueued={() => refreshDocuments()} spaceId={spaceId} /></SidePanel>
    <DocumentDetailPanel documentId={selectedDocumentId} onClose={() => setSelectedDocumentId(null)} />
  </div>;
}
