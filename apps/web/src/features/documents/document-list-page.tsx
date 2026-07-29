import { useMemo, useState } from 'react';

import { FileText, Globe2, Search, Upload } from 'lucide-react';
import { Link, Navigate, useParams } from 'react-router';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useAuth } from '@/features/auth/auth-provider';
import { useSpacesQuery } from '@/features/spaces/use-spaces-query';

import { DocumentUploadPanel } from './document-upload-panel';
import { DocumentUrlImportPanel } from './document-url-import-panel';
import { useDocumentsQuery } from './use-documents-query';

const STATUS_OPTIONS = [
  { value: '', label: '全部状态' },
  { value: 'READY', label: '已就绪' },
  { value: 'FAILED', label: '失败' },
  { value: 'QUEUED', label: '处理中' },
];

const typeLabel = (mimeType: string | null | undefined) => {
  if (!mimeType) return '文件';
  const subtype = mimeType.split('/').at(-1);
  return subtype?.toUpperCase() ?? '文件';
};

export function DocumentListPage() {
  const { spaceId = '' } = useParams();
  const auth = useAuth();
  const spacesQuery = useSpacesQuery(auth.authorizedFetch);
  const selectedSpace = spacesQuery.data?.find((space) => space.id === spaceId);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [showUpload, setShowUpload] = useState(false);
  const [showUrlImport, setShowUrlImport] = useState(false);
  const documentsQuery = useDocumentsQuery(auth.authorizedFetch, spaceId, {
    search,
    status: statusFilter,
  });
  const canEdit = selectedSpace?.effectivePermission === 'EDIT' || selectedSpace?.effectivePermission === 'MANAGE';
  const documents = useMemo(
    () =>
      (documentsQuery.data ?? []).filter((document) =>
        typeFilter ? document.latestVersion?.declaredMimeType === typeFilter : true,
      ),
    [documentsQuery.data, typeFilter],
  );
  const documentTypes = useMemo(
    () =>
      [...new Set((documentsQuery.data ?? []).map((document) => document.latestVersion?.declaredMimeType).filter(Boolean))] as string[],
    [documentsQuery.data],
  );

  if (!spaceId) return <Navigate replace to="/spaces" />;

  return (
    <div className="space-y-7">
      <p className="text-sm text-slate-500">
        <Link className="hover:text-blue-700" to="/spaces">知识空间</Link> /{' '}
        <Link className="hover:text-blue-700" to={`/spaces/${spaceId}`}>{selectedSpace?.name ?? '加载中'}</Link> / 文档
      </p>
      <section className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-blue-700">知识空间</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">{selectedSpace?.name ?? '文档'}</h1>
          <p className="mt-2 text-sm text-slate-500">上传、管理和检索当前知识空间内的资料。</p>
        </div>
      </section>
      <nav className="flex border-b border-slate-200" aria-label="空间导航">
        <Link className="border-b-2 border-transparent px-4 py-3 text-sm text-slate-500 hover:text-slate-900" to={`/spaces/${spaceId}`}>空间概览</Link>
        <Link className="border-b-2 border-blue-700 px-4 py-3 text-sm font-medium text-blue-700" to={`/spaces/${spaceId}/documents`}>文档</Link>
        {selectedSpace?.effectivePermission === 'MANAGE' ? <Link className="border-b-2 border-transparent px-4 py-3 text-sm text-slate-500 hover:text-slate-900" to={`/spaces/${spaceId}/members`}>成员与权限</Link> : null}
      </nav>
      {canEdit && showUpload ? (
        <DocumentUploadPanel
          fetcher={auth.authorizedFetch}
          getAccessToken={auth.getAccessToken}
          onQueued={documentsQuery.refetch}
          refreshAccessToken={auth.refreshAccessToken}
          spaceId={spaceId}
        />
      ) : null}
      {canEdit && showUrlImport ? (
        <DocumentUrlImportPanel fetcher={auth.authorizedFetch} onQueued={documentsQuery.refetch} spaceId={spaceId} />
      ) : null}
      <section aria-label="文档列表">
        <div className="mb-4 flex items-center justify-between gap-4">
          <div className="flex flex-1 items-center gap-3">
            <label className="relative max-w-md flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} aria-hidden="true" />
              <span className="sr-only">搜索文档名称</span>
              <input
                className="h-9 w-full rounded-md border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                placeholder="搜索文档名称"
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <select className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-600" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
              <option value="">全部类型</option>
              {documentTypes.map((type) => <option key={type} value={type}>{typeLabel(type)}</option>)}
            </select>
            <select className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-600" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </div>
          {canEdit ? (
            <div className="flex items-center gap-2">
              <Button onClick={() => setShowUrlImport((current) => !current)} type="button" variant="outline">
                <Globe2 size={16} aria-hidden="true" /> 导入网页
              </Button>
              <Button onClick={() => setShowUpload((current) => !current)} type="button">
                <Upload size={16} aria-hidden="true" /> 上传文档
              </Button>
            </div>
          ) : null}
        </div>
        <Card className="overflow-hidden">
          <table className="w-full table-fixed border-collapse text-left text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr><th className="w-[40%] px-5 py-3 font-medium">文档名称</th><th className="w-[15%] px-4 py-3 font-medium">来源</th><th className="w-[15%] px-4 py-3 font-medium">状态</th><th className="w-[20%] px-4 py-3 font-medium">更新时间</th><th className="w-[10%] px-5 py-3 text-right font-medium">操作</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {documentsQuery.isPending ? <tr><td className="px-5 py-10 text-center text-slate-500" colSpan={5}>正在加载文档…</td></tr> : null}
              {documentsQuery.isError ? <tr><td className="px-5 py-10 text-center text-red-600" colSpan={5}>文档列表加载失败，请稍后重试。</td></tr> : null}
              {!documentsQuery.isPending && !documentsQuery.isError && documents.length === 0 ? <tr><td className="px-5 py-10 text-center text-slate-500" colSpan={5}>当前筛选条件下没有文档。</td></tr> : null}
              {documents.map((document) => {
                const status = document.latestVersion?.processingStatus ?? 'PENDING_UPLOAD';
                const ready = status === 'READY';
                return (
                  <tr className="hover:bg-slate-50" key={document.id}>
                    <td className="px-5 py-4"><Link className="flex items-center gap-3" to={`/documents/${document.id}`}><span className="grid size-8 place-items-center rounded-md bg-blue-50 text-blue-700"><FileText size={17} aria-hidden="true" /></span><span className="min-w-0"><span className="block truncate font-medium text-slate-800">{document.title}</span><span className="mt-1 block text-xs text-slate-400">{typeLabel(document.latestVersion?.declaredMimeType)}</span></span></Link></td>
                    <td className="px-4 py-4 text-slate-500">{document.sourceType === 'URL' ? '网页导入' : '文件上传'}</td>
                    <td className="px-4 py-4"><Badge className={ready ? 'bg-emerald-50 text-emerald-700' : status === 'FAILED' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}>{ready ? '已就绪' : status === 'FAILED' ? '失败' : '处理中'}</Badge></td>
                    <td className="px-4 py-4 text-slate-500">{new Date(document.updatedAt).toLocaleString('zh-CN')}</td>
                    <td className="px-5 py-4 text-right"><Link className="text-sm font-medium text-blue-700 hover:text-blue-800" to={`/documents/${document.id}`}>查看</Link></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      </section>
    </div>
  );
}
