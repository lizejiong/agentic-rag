import { useState, type FormEvent } from 'react';

import { Globe2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

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
    return url.protocol === 'http:' || url.protocol === 'https:' ? null : '仅支持 HTTP 或 HTTPS 页面。';
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
      setError(caught instanceof Error ? caught.message : '网页导入失败，请稍后重试。');
      await onQueued();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-5" aria-labelledby="url-import-title">
      <div className="flex items-center gap-2 text-sm font-medium text-blue-700">
        <Globe2 size={17} aria-hidden="true" /> 导入网页
      </div>
      <h2 className="mt-3 text-base font-semibold" id="url-import-title">导入公开网页正文</h2>
      <p className="mt-2 text-sm text-slate-500">仅抓取单个公开页面，不执行页面脚本，也不会递归抓取链接。</p>
      <form onSubmit={(event) => void submit(event)}>
        <label className="sr-only" htmlFor="document-url">页面地址</label>
        <div className="mt-4 flex gap-3">
          <input
            id="document-url"
            className="h-9 flex-1 rounded-md border border-slate-200 px-3 text-sm outline-none placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            type="url"
            value={url}
            placeholder="https://example.com/article"
            maxLength={2048}
            disabled={busy}
            onChange={(event) => setUrl(event.target.value)}
          />
          <Button disabled={busy || !url.trim()} type="submit">{busy ? '正在抓取…' : '导入网页'}</Button>
        </div>
      </form>
      {message ? <p className="mt-3 text-sm text-slate-500" role="status">{message}</p> : null}
      {error ? <p className="mt-3 text-sm text-red-600" role="alert">{error}</p> : null}
    </Card>
  );
}
