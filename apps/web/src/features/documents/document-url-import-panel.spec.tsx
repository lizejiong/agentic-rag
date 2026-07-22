import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Fetcher } from '../../shared/api/request-json';
import { DocumentUrlImportPanel } from './document-url-import-panel';

const ticket = {
  documentId: '1c0078c7-5818-4527-966b-e0663c476374',
  versionId: 'd57d4f96-82f4-454b-a101-071fcde1f119',
  importId: '89321158-2038-4b7f-a20c-ea92e6b4090c',
  status: 'QUEUED',
};

afterEach(cleanup);

describe('DocumentUrlImportPanel', () => {
  it('queues a valid URL and waits for completion', async () => {
    const fetcher = vi
      .fn<Fetcher>()
      .mockResolvedValueOnce(new Response(JSON.stringify(ticket), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: ticket.importId,
            documentId: ticket.documentId,
            versionId: ticket.versionId,
            status: 'SUCCEEDED',
            stage: 'READY',
            progress: 100,
            attempt: 1,
            errorCode: null,
            errorMessage: null,
            startedAt: '2026-07-22T00:00:00.000Z',
            completedAt: '2026-07-22T00:00:01.000Z',
            createdAt: '2026-07-22T00:00:00.000Z',
            updatedAt: '2026-07-22T00:00:01.000Z',
          }),
          { status: 200 },
        ),
      );
    const onQueued = vi.fn();
    render(
      <DocumentUrlImportPanel
        spaceId="b7b7cbbd-0d42-40dc-9895-86f7859166ea"
        fetcher={fetcher}
        onQueued={onQueued}
      />,
    );

    fireEvent.change(screen.getByLabelText('页面地址'), {
      target: { value: 'https://example.com/article' },
    });
    fireEvent.click(screen.getByRole('button', { name: '导入网页' }));

    await screen.findByText('页面正文已导入知识库。');
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(onQueued).toHaveBeenCalledTimes(2);
  });

  it('rejects non-HTTP protocols without calling the API', async () => {
    const fetcher = vi.fn<Fetcher>();
    render(
      <DocumentUrlImportPanel
        spaceId="b7b7cbbd-0d42-40dc-9895-86f7859166ea"
        fetcher={fetcher}
        onQueued={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText('页面地址'), {
      target: { value: 'ftp://example.com/a' },
    });
    fireEvent.submit(screen.getByRole('button', { name: '导入网页' }).closest('form')!);

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('仅支持 HTTP 或 HTTPS 页面。'),
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
});
