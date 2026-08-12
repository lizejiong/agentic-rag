import { Link, useLocation } from 'react-router';

import { cn } from '@/lib/utils';

const tabClass = (active: boolean) => cn('border-b-2 px-4 py-3 text-sm transition-colors', active ? 'border-blue-700 font-medium text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-900');

export function SpaceTabs({ spaceId, spaceName, canManage }: { spaceId: string; spaceName: string | undefined; canManage: boolean }) {
  const currentPath = useLocation().pathname;
  const tabs = [
    { to: `/spaces/${spaceId}`, label: '空间概览', active: currentPath === `/spaces/${spaceId}` },
    { to: `/spaces/${spaceId}/documents`, label: '文档', active: currentPath.endsWith('/documents') },
    { to: `/spaces/${spaceId}/graph`, label: '知识图谱', active: currentPath.endsWith('/graph') },
    ...(canManage ? [{ to: `/spaces/${spaceId}/members`, label: '成员与权限', active: currentPath.endsWith('/members') }] : []),
  ];
  const activeLabel = tabs.find((tab) => tab.active)?.label ?? '空间概览';
  return <div className="space-y-3"><p className="text-sm text-slate-500"><Link className="hover:text-blue-700" to="/spaces">知识空间</Link> / <span>{spaceName ?? '加载中'}</span> / <span>{activeLabel}</span></p><nav aria-label="空间导航" className="flex border-b border-slate-200">{tabs.map((tab) => <Link className={tabClass(tab.active)} key={tab.to} to={tab.to}>{tab.label}</Link>)}</nav></div>;
}
