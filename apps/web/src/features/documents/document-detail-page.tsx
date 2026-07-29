import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Download, Eye, FileText, RefreshCw, Trash2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

import { useAuth } from '../auth/auth-provider';
import {
  deleteDocument,
  downloadDocument,
  getDocumentChunks,
  getDocumentContent,
  replaceFile,
  uploadFile,
  waitForImport,
  type DocumentChunk,
  type DocumentContent,
} from './documents-api';
import { useDocumentQuery } from './use-document-query';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatLocation(location: unknown): string {
  if (!location || typeof location !== 'object') return '-';
  const value = location as Record<string, unknown>;
  const parts = [value.page != null ? `p${value.page}` : null, value.slide != null ? `slide ${value.slide}` : null, value.sheet ? String(value.sheet) : null].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : '-';
}

function statusLabel(status: string): string {
  if (['READY', 'SUCCEEDED', 'ACTIVE'].includes(status)) return '已就绪';
  if (['FAILED', 'CANCELLED'].includes(status)) return '失败';
  return '处理中';
}

function StatusBadge({ status }: { status: string }) {
  const tone = ['READY', 'SUCCEEDED', 'ACTIVE'].includes(status)
    ? 'bg-emerald-50 text-emerald-700'
    : ['FAILED', 'CANCELLED'].includes(status)
      ? 'bg-red-50 text-red-700'
      : 'bg-amber-50 text-amber-700';
  return <Badge className={tone}>{statusLabel(status)}</Badge>;
}

export function DocumentDetailPage() {
  const { documentId = '' } = useParams();
  const navigate = useNavigate();
  const auth = useAuth();
  const document = useDocumentQuery(auth.authorizedFetch, documentId);
  const [contentView, setContentView] = useState<'hidden' | 'loading' | 'visible'>('hidden');
  const [documentContent, setDocumentContent] = useState<DocumentContent | null>(null);
  const [contentError, setContentError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [chunks, setChunks] = useState<DocumentChunk[] | null>(null);
  const [chunksLoading, setChunksLoading] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const replaceInput = useRef<HTMLInputElement>(null);

  const handleLoadChunks = async () => {
    setChunksLoading(true);
    try {
      setChunks(await getDocumentChunks(auth.authorizedFetch, documentId));
    } catch {
      setContentError('CHUNK_LIST_LOAD_FAILED');
    } finally {
      setChunksLoading(false);
    }
  };

  const handleView = async () => {
    setContentView('loading');
    setContentError(null);
    try {
      setDocumentContent(await getDocumentContent(auth.authorizedFetch, documentId));
      setContentView('visible');
    } catch (error: unknown) {
      setContentError(error instanceof Error ? error.message : 'DOCUMENT_CONTENT_LOAD_FAILED');
      setContentView('hidden');
    }
  };

  const handleDownload = async () => {
    const currentVersion = document.data?.versions[0];
    if (!currentVersion) return;
    try {
      await downloadDocument(auth.authorizedFetch, documentId, currentVersion.originalFileName);
    } catch (error: unknown) {
      setContentError(error instanceof Error ? error.message : 'DOCUMENT_DOWNLOAD_FAILED');
    }
  };

  const handleReplace = async (file: File) => {
    setReplacing(true);
    try {
      const ticket = await replaceFile(auth.authorizedFetch, documentId, {
        fileName: file.name,
        sizeBytes: file.size,
        mimeType: file.type || 'application/octet-stream',
      });
      const token = auth.getAccessToken() ?? (await auth.refreshAccessToken());
      if (!token) throw new Error('AUTH_SESSION_EXPIRED');
      await uploadFile({ clientFileId: crypto.randomUUID(), ...ticket }, file, token, () => {});
      await waitForImport(auth.authorizedFetch, ticket.importId);
      await document.refetch();
    } catch (error: unknown) {
      setContentError(error instanceof Error ? error.message : 'FILE_REPLACE_FAILED');
    } finally {
      setReplacing(false);
    }
  };

  const handleDelete = async () => {
    if (!document.data || !window.confirm('确定要删除此文档吗？删除后可从回收站恢复。')) return;
    setDeleting(true);
    try {
      await deleteDocument(auth.authorizedFetch, documentId);
      navigate(`/spaces/${document.data.spaceId}/documents`, { replace: true });
    } catch (error: unknown) {
      setContentError(error instanceof Error ? error.message : 'DOCUMENT_DELETE_FAILED');
      setDeleting(false);
    }
  };

  if (document.isPending) return <p className="py-16 text-center text-sm text-slate-500">正在加载文档…</p>;
  if (document.isError || !document.data) {
    return <p className="py-16 text-center text-sm text-red-600" role="alert">文档加载失败或不存在。</p>;
  }

  const doc = document.data;
  const activeVersion = doc.versions[0];
  return (
    <div className="space-y-7">
      <p className="text-sm text-slate-500">
        <Link className="hover:text-blue-700" to="/spaces">知识空间</Link> /{' '}
        <Link className="hover:text-blue-700" to={`/spaces/${doc.spaceId}/documents`}>文档</Link> / {doc.title}
      </p>
      <section className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <div className="flex items-center gap-3 text-sm text-blue-700"><FileText className="size-4" aria-hidden="true" />文档详情</div>
          <h1 className="mt-2 truncate text-2xl font-semibold tracking-tight text-slate-900">{doc.title}</h1>
          <p className="mt-2 text-sm text-slate-500">查看解析结果、版本记录与已生成的文本块。</p>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => void handleView()} disabled={contentView === 'loading'}><Eye className="size-4" />{contentView === 'loading' ? '加载中…' : '查看内容'}</Button>
          <Button type="button" variant="outline" onClick={() => void handleDownload()} disabled={!activeVersion || activeVersion.processingStatus !== 'READY'}><Download className="size-4" />下载原文件</Button>
          <input ref={replaceInput} className="sr-only" type="file" accept=".pdf,.docx,.doc,.xlsx,.xls,.pptx,.ppt,.txt,.md,.csv,.json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void handleReplace(file); }} />
          <Button type="button" variant="outline" disabled={replacing} onClick={() => replaceInput.current?.click()}><RefreshCw className="size-4" />{replacing ? '替换中…' : '替换文件'}</Button>
          <Button type="button" variant="outline" className="border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800" disabled={deleting} onClick={() => void handleDelete()}><Trash2 className="size-4" />{deleting ? '删除中…' : '删除'}</Button>
        </div>
      </section>

      {contentError ? <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">{contentError}</p> : null}

      <Card className="p-5">
        <dl className="grid grid-cols-5 gap-5 text-sm">
          <div><dt className="text-slate-400">来源类型</dt><dd className="mt-2 font-medium text-slate-700">{doc.sourceType === 'URL' ? '网页导入' : '文件上传'}</dd></div>
          <div><dt className="text-slate-400">当前状态</dt><dd className="mt-2"><StatusBadge status={doc.availability} /></dd></div>
          {doc.createdBy ? <div><dt className="text-slate-400">上传人</dt><dd className="mt-2 font-medium text-slate-700">{doc.createdBy.username}</dd></div> : null}
          <div><dt className="text-slate-400">创建时间</dt><dd className="mt-2 text-slate-700">{new Date(doc.createdAt).toLocaleString('zh-CN')}</dd></div>
          <div><dt className="text-slate-400">更新时间</dt><dd className="mt-2 text-slate-700">{new Date(doc.updatedAt).toLocaleString('zh-CN')}</dd></div>
        </dl>
      </Card>

      {contentView === 'visible' && documentContent ? (
        <Card className="overflow-hidden"><div className="border-b border-slate-200 px-5 py-4"><h2 className="font-semibold text-slate-900">已解析内容</h2><p className="mt-1 text-sm text-slate-500">共 {documentContent.elementCount} 个元素</p></div><pre className="max-h-96 overflow-auto whitespace-pre-wrap p-5 text-sm leading-6 text-slate-700">{documentContent.fullText}</pre></Card>
      ) : null}

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4"><div><h2 className="font-semibold text-slate-900">文本块（Chunks）</h2><p className="mt-1 text-sm text-slate-500">用于检索与引用的解析片段。</p></div>{!chunks ? <Button type="button" variant="outline" size="sm" disabled={chunksLoading} onClick={() => void handleLoadChunks()}>{chunksLoading ? '加载中…' : '加载文本块'}</Button> : null}</div>
        {chunks ? chunks.length === 0 ? <p className="px-5 py-10 text-center text-sm text-slate-500">暂无文本块。</p> : <table className="w-full table-fixed text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="w-16 px-5 py-3 font-medium">#</th><th className="px-4 py-3 font-medium">内容</th><th className="w-24 px-4 py-3 font-medium">Token</th><th className="w-40 px-5 py-3 font-medium">位置</th></tr></thead><tbody className="divide-y divide-slate-100">{chunks.map((chunk) => <tr key={chunk.id}><td className="px-5 py-4 text-slate-500">{chunk.index}</td><td className="px-4 py-4 text-slate-700">{chunk.content.slice(0, 200)}{chunk.content.length > 200 ? '…' : ''}</td><td className="px-4 py-4 text-slate-500">{chunk.tokenCount}</td><td className="px-5 py-4 text-slate-500">{formatLocation(chunk.location)}</td></tr>)}</tbody></table> : null}
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b border-slate-200 px-5 py-4"><h2 className="font-semibold text-slate-900">版本历史</h2><p className="mt-1 text-sm text-slate-500">替换文件后会保留新的版本记录。</p></div>
        {doc.versions.length === 0 ? <p className="px-5 py-10 text-center text-sm text-slate-500">暂无版本记录。</p> : <table className="w-full table-fixed text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="w-20 px-5 py-3 font-medium">版本</th><th className="px-4 py-3 font-medium">文件名</th><th className="w-44 px-4 py-3 font-medium">类型</th><th className="w-24 px-4 py-3 font-medium">大小</th><th className="w-24 px-4 py-3 font-medium">状态</th><th className="w-48 px-5 py-3 font-medium">发布时间</th></tr></thead><tbody className="divide-y divide-slate-100">{doc.versions.map((version) => <tr key={version.id}><td className="px-5 py-4 text-slate-500">v{version.versionNumber}</td><td className="truncate px-4 py-4 text-slate-700">{version.originalFileName}</td><td className="truncate px-4 py-4 text-slate-500">{version.detectedMimeType ?? version.declaredMimeType}</td><td className="px-4 py-4 text-slate-500">{version.sizeBytes != null ? formatBytes(version.sizeBytes) : '-'}</td><td className="px-4 py-4"><StatusBadge status={version.processingStatus} /></td><td className="px-5 py-4 text-slate-500">{version.publishedAt ? new Date(version.publishedAt).toLocaleString('zh-CN') : '-'}</td></tr>)}</tbody></table>}
      </Card>
    </div>
  );
}
