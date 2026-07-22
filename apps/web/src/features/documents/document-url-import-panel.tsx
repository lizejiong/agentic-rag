import { useState, type FormEvent } from 'react';

import type { Fetcher } from '../../shared/api/request-json';
import { createUrlImport, waitForImport } from './documents-api';

interface DocumentUrlImportPanelProps {
  spaceId: string;
  fetcher: Fetcher;
  onQueued: () => Promise<unknown> | unknown;
}

function validateUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? null
      : '仅支持 HTTP 或 HTTPS 页面。';
  } catch {
    return '请输入完整、有效的页面地址。';
  }
}

export function DocumentUrlImportPanel({
  spaceId,
  fetcher,
  onQueued,
}: DocumentUrlImportPanelProps) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const validationError = validateUrl(url.trim());
    if (validationError) {
      setError(validationError);
      return;
    }
    setBusy(true);
    setError(null);
    setMessage('页面已进入抓取队列。');
    try {
      const ticket = await createUrlImport(fetcher, spaceId, url.trim());
      await onQueued();
      await waitForImport(fetcher, ticket.importId);
      setUrl('');
      setMessage('页面正文已导入知识库。');
      await onQueued();
    } catch (caught) {
      setMessage(null);
      setError(caught instanceof Error ? caught.message : '页面导入失败，请稍后重试。');
      await onQueued();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="url-import-panel" aria-labelledby="url-import-title">
      <div>
        <p className="eyebrow">WEB PAGE</p>
        <h2 id="url-import-title">导入网页正文</h2>
        <p>支持公开单页，不执行页面脚本，也不会递归抓取链接。</p>
      </div>
      <form onSubmit={(event) => void submit(event)}>
        <label htmlFor="document-url">页面地址</label>
        <div className="url-import-controls">
          <input
            id="document-url"
            type="url"
            value={url}
            placeholder="https://example.com/article"
            maxLength={2048}
            disabled={busy}
            onChange={(event) => setUrl(event.target.value)}
          />
          <button type="submit" className="upload-button" disabled={busy || !url.trim()}>
            {busy ? '正在抓取…' : '导入网页'}
          </button>
        </div>
      </form>
      {message ? <p role="status">{message}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}
