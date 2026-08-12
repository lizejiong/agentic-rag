import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Navigate, useParams } from 'react-router';
import { z } from 'zod';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useAuth } from '@/features/auth/auth-provider';
import { requestJson } from '@/shared/api/request-json';

import { SpaceTabs } from './space-tabs';
import { visibleSpacesQueryKey } from './use-spaces-query';

const grantSchema = z.object({ id: z.uuid(), subjectType: z.enum(['USER', 'DEPARTMENT', 'GROUP']), subjectId: z.uuid(), permission: z.enum(['VIEW', 'EDIT', 'MANAGE']), expiresAt: z.string().nullable() });
const detailSchema = z.object({ id: z.uuid(), name: z.string(), effectivePermission: z.enum(['VIEW', 'EDIT', 'MANAGE']), grants: z.array(grantSchema).optional() });
const usersSchema = z.array(z.object({ id: z.uuid(), username: z.string(), displayName: z.string(), status: z.enum(['ACTIVE', 'DISABLED']) }));

export function SpaceMembersPage() {
  const { spaceId = '' } = useParams();
  const auth = useAuth();
  const queryClient = useQueryClient();
  const detail = useQuery({ queryKey: ['spaces', spaceId, 'detail'], enabled: Boolean(spaceId), queryFn: () => requestJson({ schema: detailSchema, input: `/api/spaces/${spaceId}`, fetcher: auth.authorizedFetch }) });
  const users = useQuery({ queryKey: ['users'], queryFn: () => requestJson({ schema: usersSchema, input: '/api/users', fetcher: auth.authorizedFetch }) });
  const [userId, setUserId] = useState('');
  const [permission, setPermission] = useState('VIEW');
  const [error, setError] = useState<string>();
  if (!spaceId) return <Navigate replace to="/spaces" />;
  const refresh = async () => { await queryClient.invalidateQueries({ queryKey: ['spaces', spaceId, 'detail'] }); await queryClient.invalidateQueries({ queryKey: visibleSpacesQueryKey }); };
  const save = async () => { if (!userId) return; setError(undefined); try { const response = await auth.authorizedFetch(`/api/spaces/${spaceId}/grants`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ subjectType: 'USER', subjectId: userId, permission }) }); if (!response.ok) throw new Error(await response.text()); await refresh(); setUserId(''); } catch (cause) { setError(cause instanceof Error ? cause.message : '保存授权失败'); } };
  if (detail.data && detail.data.effectivePermission !== 'MANAGE') return <p className="py-16 text-center text-sm text-slate-500">你没有管理此空间成员与权限的权限。</p>;
  return <div className="space-y-7"><SpaceTabs canManage spaceId={spaceId} spaceName={detail.data?.name} /><Card className="p-5"><h2 className="font-semibold">添加成员</h2><div className="mt-4 flex gap-3"><select className="h-9 flex-1 rounded-md border border-slate-200 px-3 text-sm" onChange={(event) => setUserId(event.target.value)} value={userId}><option value="">选择用户</option>{users.data?.filter((user) => user.status === 'ACTIVE').map((user) => <option key={user.id} value={user.id}>{user.displayName}（{user.username}）</option>)}</select><select className="h-9 rounded-md border border-slate-200 px-3 text-sm" onChange={(event) => setPermission(event.target.value)} value={permission}><option value="VIEW">仅查看</option><option value="EDIT">可编辑</option><option value="MANAGE">可管理</option></select><Button disabled={!userId} onClick={() => void save()} type="button">保存授权</Button></div>{error ? <p className="mt-3 text-sm text-red-600" role="alert">{error}</p> : null}</Card><Card className="overflow-hidden"><div className="border-b border-slate-200 px-5 py-4"><h2 className="font-semibold">直接授权记录</h2></div>{detail.data?.grants?.length ? <table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-5 py-3">对象</th><th className="px-4 py-3">类型</th><th className="px-5 py-3">权限</th></tr></thead><tbody>{detail.data.grants.map((grant) => <tr className="border-t border-slate-100" key={grant.id}><td className="px-5 py-4 text-slate-700">{users.data?.find((user) => user.id === grant.subjectId)?.displayName ?? grant.subjectId}</td><td className="px-4 py-4 text-slate-500">{grant.subjectType}</td><td className="px-5 py-4"><Badge>{grant.permission}</Badge></td></tr>)}</tbody></table> : <p className="px-5 py-10 text-center text-sm text-slate-500">暂无直接授权记录。</p>}</Card></div>;
}
