import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from '../../App';

describe('LoginPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
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
