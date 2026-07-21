import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from '../../App';
import { queryClient } from '../../app/query-client';

describe('LoginPage', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    window.history.replaceState({}, '', '/');
  });

  it('redirects an anonymous visitor from chat to login', async () => {
    window.history.replaceState({}, '', '/chat');
    queryClient.setQueryData(['spaces', 'visible'], [{ id: 'previous-user-space' }]);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({ message: 'REFRESH_TOKEN_REQUIRED' }, { status: 401 }),
      ),
    );

    render(<App />);

    expect(await screen.findByRole('heading', { name: '登录知识工作台' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/login');
    await waitFor(() => {
      expect(queryClient.getQueryData(['spaces', 'visible'])).toBeUndefined();
    });
  });

  it('shows a request identifier when login fails', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      return new Response(
        JSON.stringify({
          message: url.endsWith('/refresh') ? 'REFRESH_TOKEN_REQUIRED' : 'INVALID_CREDENTIALS',
        }),
        {
          status: 401,
          headers: { 'content-type': 'application/json' },
        },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);
    expect(await screen.findByRole('heading', { name: '登录知识工作台' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('用户名'), { target: { value: 'member' } });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'wrong-password' } });
    fireEvent.click(screen.getByRole('button', { name: '登录' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('用户名或密码不正确');
    expect(screen.getByRole('alert')).toHaveTextContent('请求编号：');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
