import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FileCheck2, FileText, LoaderCircle, Settings2 } from 'lucide-react';
import { Navigate, useParams } from 'react-router';

import { Card } from '@/components/ui/card';
import { useAuth } from '@/features/auth/auth-provider';
import { useDocumentsQuery } from '@/features/documents/use-documents-query';

import { updateSpace } from './spaces-api';
import { SpaceTabs } from './space-tabs';
import { useSpacesQuery, visibleSpacesQueryKey } from './use-spaces-query';

export function SpaceOverviewPage() {
  const { spaceId = '' } = useParams();
  const auth = useAuth();
  const queryClient = useQueryClient();
  const spacesQuery = useSpacesQuery(auth.authorizedFetch);
  const documentsQuery = useDocumentsQuery(auth.authorizedFetch, spaceId);
  const space = spacesQuery.data?.find((item) => item.id === spaceId);
  const documents = documentsQuery.data ?? [];
  const readyCount = documents.filter((document) => document.latestVersion?.processingStatus === 'READY').length;
  const processingCount = documents.length - readyCount;
  const toggleMutation = useMutation({
    mutationFn: (input: { embeddingEnabled?: boolean; rerankerEnabled?: boolean; llmEnabled?: boolean; graphExtractionEnabled?: boolean }) => updateSpace(auth.authorizedFetch, spaceId, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: visibleSpacesQueryKey });
      await spacesQuery.refetch();
    },
  });

  if (!spaceId) return <Navigate replace to="/spaces" />;

  return (
    <div className="space-y-7">
      <SpaceTabs canManage={space?.effectivePermission === 'MANAGE'} spaceId={spaceId} spaceName={space?.name} />
      <section aria-label="空间统计" className="grid grid-cols-3 gap-5">
        <StatCard icon={FileText} label="文档总数" loading={documentsQuery.isPending} value={documents.length} />
        <StatCard icon={FileCheck2} label="已就绪文档" loading={documentsQuery.isPending} value={readyCount} />
        <StatCard icon={LoaderCircle} label="处理中任务" loading={documentsQuery.isPending} value={processingCount} />
      </section>
      {space?.effectivePermission === 'MANAGE' ? (
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-2"><Settings2 className="text-slate-500" size={18} /><h2 className="font-medium text-slate-900">功能配置</h2></div>
          <div className="grid grid-cols-2 gap-4">
            <ToggleRow description="为新文档生成向量索引，以支持语义检索。" enabled={space.embeddingEnabled ?? false} label="向量检索（Embedding）" loading={toggleMutation.isPending} onChange={(value) => toggleMutation.mutate({ embeddingEnabled: value })} />
            <ToggleRow description="对检索结果进行精排，提升相关内容的排序质量。" enabled={space.rerankerEnabled ?? false} label="重排序（Reranker）" loading={toggleMutation.isPending} onChange={(value) => toggleMutation.mutate({ rerankerEnabled: value })} />
            <ToggleRow description="启用后由大模型生成自然语言回答。" enabled={space.llmEnabled ?? false} label="大模型回答（LLM）" loading={toggleMutation.isPending} onChange={(value) => toggleMutation.mutate({ llmEnabled: value })} />
            <ToggleRow description="文档完成索引后提取候选实体和关系，供审核发布。" enabled={space.graphExtractionEnabled ?? false} label="图谱候选抽取" loading={toggleMutation.isPending} onChange={(value) => toggleMutation.mutate({ graphExtractionEnabled: value })} />
          </div>
        </section>
      ) : null}
    </div>
  );
}

function ToggleRow({ label, description, enabled, loading, onChange }: { label: string; description: string; enabled: boolean; loading: boolean; onChange: (value: boolean) => void }) {
  return <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-100 bg-slate-50 p-3 transition hover:bg-slate-100"><input checked={enabled} className="mt-0.5 h-4 w-4 shrink-0 rounded accent-blue-600" disabled={loading} onChange={(event) => onChange(event.target.checked)} type="checkbox" /><div><p className="text-sm font-medium text-slate-800">{label}</p><p className="mt-0.5 text-xs leading-4 text-slate-500">{description}</p></div></label>;
}

function StatCard({ icon: Icon, label, value, loading }: { icon: typeof FileText; label: string; value: number; loading: boolean }) {
  return <Card className="p-5"><Icon aria-hidden="true" className="text-blue-700" size={20} /><p className="mt-7 text-sm text-slate-500">{label}</p><p className="mt-2 text-3xl font-semibold tabular-nums">{loading ? '—' : value}</p></Card>;
}
