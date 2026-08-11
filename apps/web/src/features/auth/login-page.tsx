import { type FormEvent, useState } from 'react';

import { LockKeyhole } from 'lucide-react';

import { ApiError } from '../../shared/api/api-error';
import { useAuth } from './auth-provider';

export function LoginPage() {
  const auth = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<{ message: string; requestId?: string }>();
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!username.trim() || !password || submitting) return;
    setSubmitting(true); setError(undefined);
    try { await auth.login(username.trim(), password); }
    catch (caught) { setError(caught instanceof ApiError ? { message: '用户名或密码不正确', requestId: caught.requestId } : { message: '暂时无法登录，请稍后重试' }); }
    finally { setSubmitting(false); }
  };
  return <main className="min-h-screen bg-slate-50 p-6 text-slate-900"><div className="mx-auto grid min-h-[calc(100vh-3rem)] max-w-[1180px] place-items-center"><section aria-labelledby="login-title" className="grid w-full max-w-4xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-200/60 md:grid-cols-[1.05fr_0.95fr]"><div className="hidden bg-blue-700 p-10 text-white md:block"><div className="grid size-10 place-items-center rounded-lg bg-white/15 text-lg font-semibold">A</div><p className="mt-16 text-sm font-medium text-blue-100">企业知识智能</p><h1 className="mt-3 text-3xl font-semibold tracking-tight">让可信知识，随时可用。</h1><p className="mt-4 max-w-sm text-sm leading-6 text-blue-100">在一个统一的工作区中管理知识、检索证据并获得可追溯的答案。</p></div><div className="p-8 sm:p-10"><div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-md bg-blue-700 text-sm font-semibold text-white">A</span><span className="text-sm font-semibold">Atlas RAG</span></div><div className="mt-10"><div className="flex items-center gap-2 text-sm font-medium text-blue-700"><LockKeyhole className="size-4" />安全登录</div><h1 className="mt-3 text-2xl font-semibold tracking-tight" id="login-title">登录知识工作台</h1><p className="mt-2 text-sm leading-6 text-slate-500">使用企业账号访问已获授权的知识空间。</p></div><form className="mt-8 space-y-5" onSubmit={(event) => void submit(event)}><label className="block text-sm font-medium text-slate-700" htmlFor="username">用户名<input autoComplete="username" className="mt-2 h-10 w-full rounded-md border border-slate-200 px-3 font-normal outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100" id="username" name="username" onChange={(event) => setUsername(event.target.value)} value={username} /></label><label className="block text-sm font-medium text-slate-700" htmlFor="password">密码<input autoComplete="current-password" className="mt-2 h-10 w-full rounded-md border border-slate-200 px-3 font-normal outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100" id="password" name="password" onChange={(event) => setPassword(event.target.value)} type="password" value={password} /></label>{error ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert"><span>{error.message}</span>{error.requestId ? <small className="mt-1 block text-red-600">请求编号：{error.requestId}</small> : null}</div> : null}<button className="h-10 w-full rounded-md bg-blue-700 text-sm font-medium text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50" disabled={submitting} type="submit">{submitting ? '正在登录…' : '登录'}</button></form></div></section></div></main>;
}
