import { Database, FileText, LoaderCircle } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { useAuth } from '@/features/auth/auth-provider';
import { useSpacesQuery } from '@/features/spaces/use-spaces-query';

const overviewCards = [
  { label: '可访问知识空间', icon: Database, key: 'spaces' },
  { label: '文档总数', icon: FileText, key: 'documents' },
  { label: '处理中任务', icon: LoaderCircle, key: 'processing' },
] as const;

export function DashboardPage() {
  const auth = useAuth();
  const spacesQuery = useSpacesQuery(auth.authorizedFetch);
  const spaces = spacesQuery.data ?? [];
  const values = {
    spaces: spaces.length,
    documents: spaces.reduce((total, space) => total + space.documentCount, 0),
    processing: '—',
  } as const;

  return (
    <div className="space-y-8">
      <section>
        <p className="text-sm font-medium text-blue-700">工作台</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">知识资产概览</h1>
        <p className="mt-2 text-sm text-slate-500">查看当前账号可访问的知识资产和处理状态。</p>
      </section>
      <section className="grid grid-cols-3 gap-5" aria-label="知识资产统计">
        {overviewCards.map(({ label, icon: Icon, key }) => (
          <Card className="p-5" key={key}>
            <Icon className="text-blue-700" size={20} aria-hidden="true" />
            <p className="mt-7 text-sm text-slate-500">{label}</p>
            <p className="mt-2 text-3xl font-semibold tabular-nums">
              {spacesQuery.isPending ? '—' : values[key]}
            </p>
          </Card>
        ))}
      </section>
      <Card className="p-6">
        <h2 className="text-base font-semibold">分析与趋势</h2>
        <p className="mt-2 text-sm text-slate-500">
          文档处理趋势、空间活跃度与质量指标会在统计接口就绪后显示在这里。
        </p>
      </Card>
    </div>
  );
}
