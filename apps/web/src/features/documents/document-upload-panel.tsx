import { useRef, useState } from 'react';

import { AlertCircle, FileUp, Upload } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

import type { Fetcher } from '../../shared/api/request-json';
import { cancelImport, createFileImports, uploadFile } from './documents-api';
import { runWithConcurrency, validateSelectedFiles, type UploadRow } from './document-upload-store';

export function DocumentUploadPanel({
  spaceId,
  fetcher,
  getAccessToken,
  refreshAccessToken,
  onQueued,
}: {
  spaceId: string;
  fetcher: Fetcher;
  getAccessToken: () => string | undefined;
  refreshAccessToken: () => Promise<string | undefined>;
  onQueued: () => Promise<unknown>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<UploadRow[]>([]);
  const [error, setError] = useState<string>();
  const busy = rows.some((row) => row.status === 'waiting' || row.status === 'uploading');

  const performUpload = async (row: UploadRow, token: string) => {
    if (!row.ticket) throw new Error('UPLOAD_TICKET_MISSING');
    setRows((current) =>
      current.map((item) =>
        item.id === row.id ? { ...item, status: 'uploading', error: undefined } : item,
      ),
    );
    try {
      await uploadFile(row.ticket, row.file, token, (progress) =>
        setRows((current) =>
          current.map((item) => (item.id === row.id ? { ...item, progress } : item)),
        ),
      );
      setRows((current) =>
        current.map((item) =>
          item.id === row.id ? { ...item, progress: 100, status: 'queued' } : item,
        ),
      );
    } catch (uploadError) {
      setRows((current) =>
        current.map((item) =>
          item.id === row.id
            ? {
                ...item,
                status: 'failed',
                error: uploadError instanceof Error ? uploadError.message : 'UPLOAD_FAILED',
              }
            : item,
        ),
      );
    }
  };

  const start = async (files: File[]) => {
    const validationError = validateSelectedFiles(files);
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(undefined);
    const nextRows = files.map<UploadRow>((file) => ({
      id: crypto.randomUUID(),
      file,
      progress: 0,
      status: 'waiting',
      error: undefined,
    }));
    setRows(nextRows);
    try {
      const response = await createFileImports(fetcher, spaceId, files);
      const token = getAccessToken() ?? (await refreshAccessToken());
      if (!token) throw new Error('AUTH_SESSION_EXPIRED');
      const ticketedRows = nextRows.map((row, index) => {
        const ticket = response.imports[index];
        if (!ticket) throw new Error('UPLOAD_TICKET_MISSING');
        return { ...row, ticket };
      });
      setRows(ticketedRows);
      await runWithConcurrency(ticketedRows, 3, async (row) => performUpload(row, token));
      await onQueued();
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : 'IMPORT_CREATE_FAILED');
      setRows((current) =>
        current.map((row) =>
          row.status === 'waiting' ? { ...row, status: 'failed', error: 'IMPORT_CREATE_FAILED' } : row,
        ),
      );
    }
  };

  const retry = async (row: UploadRow) => {
    const token = getAccessToken() ?? (await refreshAccessToken());
    if (!token) {
      setError('AUTH_SESSION_EXPIRED');
      return;
    }
    await performUpload(row, token);
    await onQueued();
  };

  const cancel = async (row: UploadRow) => {
    if (!row.ticket) return;
    await cancelImport(fetcher, row.ticket.importId);
    setRows((current) =>
      current.map((item) =>
        item.id === row.id ? { ...item, status: 'cancelled', error: undefined } : item,
      ),
    );
    await onQueued();
  };

  return (
    <Card className="p-5" aria-labelledby="upload-title">
      <div className="flex items-start justify-between gap-6">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-blue-700">
            <FileUp size={17} aria-hidden="true" /> 上传文档
          </div>
          <h2 className="mt-3 text-base font-semibold" id="upload-title">选择要导入的文件</h2>
          <p className="mt-2 text-sm text-slate-500">
            支持 PDF、Office、TXT、Markdown、CSV 和 JSON，单次最多 100 个文件。
          </p>
        </div>
        <Button disabled={busy} onClick={() => input.current?.click()} type="button">
          <Upload size={16} aria-hidden="true" /> {busy ? '正在上传…' : '选择文件'}
        </Button>
      </div>
      <input
        ref={input}
        className="sr-only"
        type="file"
        multiple
        accept=".pdf,.docx,.doc,.xlsx,.xls,.pptx,.ppt,.txt,.md,.csv,.json"
        onChange={(event) => void start(Array.from(event.target.files ?? []))}
      />
      {error ? (
        <p className="mt-4 flex items-center gap-2 text-sm text-red-600" role="alert">
          <AlertCircle size={16} aria-hidden="true" /> {error}
        </p>
      ) : null}
      {rows.length > 0 ? (
        <ul className="mt-5 divide-y divide-slate-100 border-t border-slate-100">
          {rows.map((row) => (
            <li className="grid grid-cols-[minmax(0,1fr)_160px_110px] items-center gap-4 py-3" key={row.id}>
              <span className="truncate text-sm text-slate-700">{row.file.name}</span>
              <progress className="h-2 w-full accent-blue-700" max="100" value={row.progress} />
              <span className="text-right text-sm text-slate-500">
                {row.status === 'failed' ? (
                  <button className="text-blue-700 hover:underline" type="button" onClick={() => void retry(row)}>重试</button>
                ) : row.status === 'queued' ? (
                  <button className="text-blue-700 hover:underline" type="button" onClick={() => void cancel(row)}>取消处理</button>
                ) : row.status === 'cancelled' ? '已取消' : row.error ?? `${row.progress}%`}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}
