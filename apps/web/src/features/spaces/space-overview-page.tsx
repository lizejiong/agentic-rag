import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FileCheck2, FileText, LoaderCircle, Settings2 } from 'lucide-react';
import { Link, Navigate, useParams } from 'react-router';

import { Card } from '@/components/ui/card';
import { useAuth } from '@/features/auth/auth-provider';
import { useDocumentsQuery } from '@/features/documents/use-documents-query';

import { updateSpace } from './spaces-api';
import { useSpacesQuery, visibleSpacesQueryKey } from './use-spaces-query';

export function SpaceOverviewPage() {
  const { spaceId = '' } = useParams();
  const auth = useAuth();
  const spacesQuery = useSpacesQuery(auth.authorizedFetch);
  const documentsQuery = useDocumentsQuery(auth.authorizedFetch, spaceId);
  const space = spacesQuery.data?.find((item) => item.id === spaceId);
  const documents = documentsQuery.data ?? [];
  const readyCount = documents.filter(
    (document) => document.latestVersion?.processingStatus === 'READY',
  ).length;
  const processingCount = documents.filter(
    (document) => document.latestVersion?.processingStatus !== 'READY',
  ).length;

  const queryClient = useQueryClient();
  const toggleMutation = useMutation({
    mutationFn: (input: {
      embeddingEnabled?: boolean;
      rerankerEnabled?: boolean;
      llmEnabled?: boolean;
      graphExtractionEnabled?: boolean;
    }) => updateSpace(auth.authorizedFetch, spaceId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: visibleSpacesQueryKey });
    },
  });

  if (!spaceId) return <Navigate replace to="/spaces" />;

  return (
    <div className="space-y-7">
      <p className="text-sm text-slate-500">
        <Link className="hover:text-blue-700" to="/spaces">
          知识空间
        </Link>{' '}
        / {space?.name ?? '加载中'}
      </p>
      <section className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-blue-700">知识空间</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">
            {space?.name ?? '知识空间'}
          </h1>
          <p className="mt-2 text-sm text-slate-500">{space?.description || '未填写空间描述。'}</p>
        </div>
      </section>
      <nav className="flex border-b border-slate-200" aria-label="空间导航">
        <Link
          className="border-b-2 border-blue-700 px-4 py-3 text-sm font-medium text-blue-700"
          to={`/spaces/${spaceId}`}
        >
          空间概览
        </Link>
        <Link
          className="border-b-2 border-transparent px-4 py-3 text-sm text-slate-500 hover:text-slate-900"
          to={`/spaces/${spaceId}/documents`}
        >
          文档
        </Link>
        {space?.effectivePermission === 'MANAGE' ? (
          <Link
            className="border-b-2 border-transparent px-4 py-3 text-sm text-slate-500 hover:text-slate-900"
            to={`/spaces/${spaceId}/members`}
          >
            成员与权限
          </Link>
        ) : null}
        <Link
          className="border-b-2 border-transparent px-4 py-3 text-sm text-slate-500 hover:text-slate-900"
          to={`/spaces/${spaceId}/graph`}
        >
          知识图谱
        </Link>
      </nav>
      <section className="grid grid-cols-3 gap-5" aria-label="空间统计">
        <StatCard
          icon={FileText}
          label="文档总数"
          value={documents.length}
          loading={documentsQuery.isPending}
        />
        <StatCard
          icon={FileCheck2}
          label="已就绪文档"
          value={readyCount}
          loading={documentsQuery.isPending}
        />
        <StatCard
          icon={LoaderCircle}
          label="处理中任务"
          value={processingCount}
          loading={documentsQuery.isPending}
        />
      </section>
      {space?.effectivePermission === 'MANAGE' ? (
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <Settings2 size={18} className="text-slate-500" />
            <h2 className="font-medium text-slate-900">功能配置</h2>
          </div>
          <div className="grid grid-cols-3 gap-6">
            <ToggleRow
              label="向量检索 (Embedding)"
              description="启用后对新文档自动生成向量索引，提升语义召回能力"
              enabled={space?.embeddingEnabled ?? false}
              loading={toggleMutation.isPending}
              onChange={(value) => toggleMutation.mutate({ embeddingEnabled: value })}
            />
            <ToggleRow
              label="重排序 (Reranker)"
              description="检索后调用模型精排，提升最相关 Chunk 的排名"
              enabled={space?.rerankerEnabled ?? false}
              loading={toggleMutation.isPending}
              onChange={(value) => toggleMutation.mutate({ rerankerEnabled: value })}
            />
            <ToggleRow
              label="大模型回答 (LLM)"
              description="启用后调用大模型生成自然语言回答，关闭则仅返回检索片段"
              enabled={space?.llmEnabled ?? false}
              loading={toggleMutation.isPending}
              onChange={(value) => toggleMutation.mutate({ llmEnabled: value })}
            />
            <ToggleRow
              label="图谱候选抽取"
              description="文档完成索引后提取候选实体和关系，需审核发布后才会服务"
              enabled={space?.graphExtractionEnabled ?? false}
              loading={toggleMutation.isPending}
              onChange={(value) => toggleMutation.mutate({ graphExtractionEnabled: value })}
            />
          </div>
        </section>
      ) : null}
    </div>
  );
}

function ToggleRow({
  label,
  description,
  enabled,
  loading,
  onChange,
}: {
  label: string;
  description: string;
  enabled: boolean;
  loading: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-100 bg-slate-50 p-3 transition hover:bg-slate-100">
      <input
        type="checkbox"
        className="mt-0.5 h-4 w-4 shrink-0 rounded accent-blue-600"
        checked={enabled}
        disabled={loading}
        onChange={(event) => onChange(event.target.checked)}
      />
      <div>
        <p className="text-sm font-medium text-slate-800">{label}</p>
        <p className="mt-0.5 text-xs leading-4 text-slate-500">{description}</p>
      </div>
    </label>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  loading,
}: {
  icon: typeof FileText;
  label: string;
  value: number;
  loading: boolean;
}) {
  return (
    <Card className="p-5">
      <Icon className="text-blue-700" size={20} aria-hidden="true" />
      <p className="mt-7 text-sm text-slate-500">{label}</p>
      <p className="mt-2 text-3xl font-semibold tabular-nums">{loading ? '—' : value}</p>
    </Card>
  );
}
