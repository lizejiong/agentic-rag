import { type FormEvent, useState } from 'react';

import { ApiError } from './auth-client';
import { useAuth } from './auth-provider';

export function LoginPage() {
  const auth = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<{ message: string; requestId?: string }>();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!username.trim() || !password || submitting) {
      return;
    }
    setSubmitting(true);
    setError(undefined);
    try {
      await auth.login(username.trim(), password);
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? { message: '用户名或密码不正确', requestId: caught.requestId }
          : { message: '暂时无法登录，请稍后重试' },
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="login-page">
      <section className="login-panel" aria-labelledby="login-title">
        <a className="brand login-brand" href="/" aria-label="Atlas RAG 首页">
          <span className="brand-mark" aria-hidden="true">
            A
          </span>
          <span>
            <strong>Atlas RAG</strong>
            <small>企业知识智能</small>
          </span>
        </a>
        <p className="eyebrow">SECURE KNOWLEDGE ACCESS</p>
        <h1 id="login-title">登录知识工作台</h1>
        <p className="login-intro">使用本地企业账号访问已授权的知识空间。</p>
        <form className="login-form" onSubmit={(event) => void submit(event)}>
          <label htmlFor="username">用户名</label>
          <input
            id="username"
            name="username"
            autoComplete="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
          <label htmlFor="password">密码</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          {error ? (
            <div className="login-error" role="alert">
              <span>{error.message}</span>
              {error.requestId ? <small>请求编号：{error.requestId}</small> : null}
            </div>
          ) : null}
          <button type="submit" className="send-button login-button" disabled={submitting}>
            {submitting ? '正在登录…' : '登录'}
          </button>
        </form>
      </section>
    </main>
  );
}
