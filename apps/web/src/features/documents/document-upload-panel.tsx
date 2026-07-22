import { useRef, useState } from 'react';

import type { Fetcher } from '../../shared/api/request-json';
import { cancelImport, createFileImports, uploadFile } from './documents-api';
import {
  runWithConcurrency,
  validateSelectedFiles,
  type UploadRow,
} from './document-upload-store';

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
      await runWithConcurrency(ticketedRows, 3, async (row) => {
        await performUpload(row, token);
      });
      await onQueued();
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : '导入任务创建失败。');
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
      setError('登录会话已过期。');
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
    <section className="upload-panel" aria-labelledby="upload-title">
      <div>
        <p className="eyebrow">DOCUMENT INGESTION</p>
        <h2 id="upload-title">导入文档</h2>
        <p>支持 PDF、Office、TXT、Markdown、CSV 和 JSON，最多同时上传 3 个。</p>
      </div>
      <input
        ref={input}
        className="visually-hidden"
        type="file"
        multiple
        accept=".pdf,.docx,.doc,.xlsx,.xls,.pptx,.ppt,.txt,.md,.csv,.json"
        onChange={(event) => void start(Array.from(event.target.files ?? []))}
      />
      <button type="button" className="upload-button" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? '正在上传…' : '选择文件'}
      </button>
      {error ? <p role="alert">{error}</p> : null}
      {rows.length > 0 ? (
        <ul className="upload-rows">
          {rows.map((row) => (
            <li key={row.id}>
              <span>{row.file.name}</span>
              <progress max="100" value={row.progress} />
              <small>
                {row.status === 'failed' ? (
                  <button type="button" onClick={() => void retry(row)}>重试</button>
                ) : row.status === 'queued' ? (
                  <button type="button" onClick={() => void cancel(row)}>取消处理</button>
                ) : row.status === 'cancelled' ? '已取消' : row.error ?? `${row.progress}%`}
              </small>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
