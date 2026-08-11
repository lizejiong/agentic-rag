import { useQuery } from '@tanstack/react-query';

import { Badge } from '@/components/ui/badge';
import { SidePanel } from '@/components/ui/side-panel';
import { useAuth } from '@/features/auth/auth-provider';

import { getDocumentChunks, getDocumentContent, type DocumentChunk } from './documents-api';
import { useDocumentQuery } from './use-document-query';

function StatusBadge({ status }: { status: string }) {
  const ready = ['READY', 'SUCCEEDED', 'ACTIVE'].includes(status);
  const failed = ['FAILED', 'CANCELLED'].includes(status);
  return <Badge className={ready ? 'bg-emerald-50 text-emerald-700' : failed ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}>{ready ? '已就绪' : failed ? '失败' : '处理中'}</Badge>;
}
function ChunkTable({ chunks }: { chunks: DocumentChunk[] }) {
  if (!chunks.length) return <p className="py-8 text-center text-sm text-slate-500">暂无文本块。</p>;
  return <div className="max-h-72 overflow-y-auto overscroll-contain"><table className="w-full table-fixed text-left text-sm"><thead className="sticky top-0 bg-slate-50 text-xs text-slate-500"><tr><th className="w-14 px-3 py-2">#</th><th className="px-3 py-2">内容</th><th className="w-20 px-3 py-2">Token</th></tr></thead><tbody className="divide-y divide-slate-100">{chunks.map((chunk) => <tr key={chunk.id}><td className="px-3 py-3 text-slate-500">{chunk.index}</td><td className="px-3 py-3 text-slate-700">{chunk.content}</td><td className="px-3 py-3 text-slate-500">{chunk.tokenCount}</td></tr>)}</tbody></table></div>;
}
export function DocumentDetailPanel({ documentId, onClose }: { documentId: string | null; onClose: () => void }) {
  const auth = useAuth();
  const detail = useDocumentQuery(auth.authorizedFetch, documentId ?? '');
  const content = useQuery({ queryKey: ['document', documentId, 'content'], enabled: Boolean(documentId), queryFn: ({ signal }) => getDocumentContent(auth.authorizedFetch, documentId!, signal) });
  const chunks = useQuery({ queryKey: ['document', documentId, 'chunks'], enabled: Boolean(documentId), queryFn: ({ signal }) => getDocumentChunks(auth.authorizedFetch, documentId!, signal) });
  return <SidePanel onClose={onClose} open={Boolean(documentId)} title="文档详情">{detail.isPending ? <p className="text-sm text-slate-500">正在加载文档…</p> : null}{detail.isError || !detail.data ? <p className="text-sm text-red-600" role="alert">文档加载失败，请稍后重试。</p> : null}{detail.data ? <div className="space-y-5"><section><h3 className="break-words text-xl font-semibold text-slate-900">{detail.data.title}</h3><div className="mt-3 flex items-center gap-3 text-sm text-slate-500"><StatusBadge status={detail.data.availability} /><span>{detail.data.sourceType === 'URL' ? '网页导入' : '文件上传'}</span><span>{new Date(detail.data.updatedAt).toLocaleString('zh-CN')}</span></div></section><section className="rounded-lg border border-slate-200"><header className="border-b border-slate-200 px-4 py-3"><h4 className="font-medium">已解析内容</h4><p className="mt-1 text-xs text-slate-500">{content.data ? `共 ${content.data.elementCount} 个元素` : '正在加载解析内容'}</p></header>{content.isError ? <p className="p-4 text-sm text-red-600">解析内容加载失败。</p> : <pre className="max-h-72 overflow-y-auto overscroll-contain whitespace-pre-wrap p-4 text-sm leading-6 text-slate-700">{content.data?.fullText ?? '正在加载…'}</pre>}</section><section className="rounded-lg border border-slate-200"><header className="border-b border-slate-200 px-4 py-3"><h4 className="font-medium">文本块（Chunks）</h4><p className="mt-1 text-xs text-slate-500">用于检索与引用的解析片段。</p></header>{chunks.isError ? <p className="p-4 text-sm text-red-600">文本块加载失败。</p> : chunks.isPending ? <p className="p-4 text-sm text-slate-500">正在加载文本块…</p> : <ChunkTable chunks={chunks.data ?? []} />}</section></div> : null}</SidePanel>;
}
