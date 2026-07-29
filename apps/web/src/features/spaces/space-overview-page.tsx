import { FileCheck2, FileText, LoaderCircle } from 'lucide-react';
import { Link, Navigate, useParams } from 'react-router';

import { Card } from '@/components/ui/card';
import { useAuth } from '@/features/auth/auth-provider';
import { useDocumentsQuery } from '@/features/documents/use-documents-query';

import { useSpacesQuery } from './use-spaces-query';

export function SpaceOverviewPage() {
  const { spaceId = '' } = useParams();
  const auth = useAuth();
  const spacesQuery = useSpacesQuery(auth.authorizedFetch);
  const documentsQuery = useDocumentsQuery(auth.authorizedFetch, spaceId);
  const space = spacesQuery.data?.find((item) => item.id === spaceId);
  const documents = documentsQuery.data ?? [];
  const readyCount = documents.filter((document) => document.latestVersion?.processingStatus === 'READY').length;
  const processingCount = documents.filter(
    (document) => document.latestVersion?.processingStatus !== 'READY',
  ).length;

  if (!spaceId) return <Navigate replace to="/spaces" />;

  return (
    <div className="space-y-7">
      <p className="text-sm text-slate-500">
        <Link className="hover:text-blue-700" to="/spaces">知识空间</Link> / {space?.name ?? '加载中'}
      </p>
      <section className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-blue-700">知识空间</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">{space?.name ?? '知识空间'}</h1>
          <p className="mt-2 text-sm text-slate-500">{space?.description || '未填写空间描述。'}</p>
        </div>
      </section>
      <nav className="flex border-b border-slate-200" aria-label="空间导航">
        <Link className="border-b-2 border-blue-700 px-4 py-3 text-sm font-medium text-blue-700" to={`/spaces/${spaceId}`}>
          空间概览
        </Link>
        <Link className="border-b-2 border-transparent px-4 py-3 text-sm text-slate-500 hover:text-slate-900" to={`/spaces/${spaceId}/documents`}>
          文档
        </Link>
        {space?.effectivePermission === 'MANAGE' ? (
          <Link className="border-b-2 border-transparent px-4 py-3 text-sm text-slate-500 hover:text-slate-900" to={`/spaces/${spaceId}/members`}>成员与权限</Link>
        ) : null}
      </nav>
      <section className="grid grid-cols-3 gap-5" aria-label="空间统计">
        <StatCard icon={FileText} label="文档总数" value={documents.length} loading={documentsQuery.isPending} />
        <StatCard icon={FileCheck2} label="已就绪文档" value={readyCount} loading={documentsQuery.isPending} />
        <StatCard icon={LoaderCircle} label="处理中任务" value={processingCount} loading={documentsQuery.isPending} />
      </section>
    </div>
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
