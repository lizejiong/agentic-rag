import { z } from 'zod';

import type { Fetcher } from '../../shared/api/request-json';
import { createRequestHeaders, requestJson } from '../../shared/api/request-json';
import {
  createFileImportsResponseSchema,
  createUrlImportResponseSchema,
  documentListSchema,
  importTaskSchema,
  type UploadTicket,
} from './document-contract';

export const allowedExtensions = new Set([
  'pdf',
  'docx',
  'doc',
  'xlsx',
  'xls',
  'pptx',
  'ppt',
  'txt',
  'md',
  'csv',
  'json',
]);

export function listDocuments(fetcher: Fetcher, spaceId: string, signal?: AbortSignal) {
  return requestJson({
    schema: documentListSchema,
    input: `/api/spaces/${spaceId}/documents`,
    init: signal ? { signal } : {},
    fetcher,
  });
}

export function createFileImports(fetcher: Fetcher, spaceId: string, files: File[]) {
  return requestJson({
    schema: createFileImportsResponseSchema,
    input: `/api/spaces/${spaceId}/imports/files`,
    init: {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        files: files.map((file) => ({
          clientFileId: crypto.randomUUID(),
          fileName: file.name,
          sizeBytes: file.size,
          mimeType: file.type || 'application/octet-stream',
        })),
      }),
    },
    fetcher,
  });
}

export function createUrlImport(fetcher: Fetcher, spaceId: string, url: string) {
  return requestJson({
    schema: createUrlImportResponseSchema,
    input: `/api/spaces/${spaceId}/imports/urls`,
    init: {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url }),
    },
    fetcher,
  });
}

export function refreshUrlImport(fetcher: Fetcher, documentId: string) {
  return requestJson({
    schema: createUrlImportResponseSchema,
    input: `/api/documents/${documentId}/refresh-url`,
    init: { method: 'POST' },
    fetcher,
  });
}

export async function waitForImport(fetcher: Fetcher, importId: string): Promise<void> {
  for (let attempt = 0; attempt < 480; attempt += 1) {
    const task = await getImportTask(fetcher, importId);
    if (task.status === 'SUCCEEDED') return;
    if (task.status === 'FAILED' || task.status === 'CANCELLED') {
      throw new Error(task.errorCode ?? `IMPORT_${task.status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  throw new Error('IMPORT_POLL_TIMEOUT');
}

export function getImportTask(fetcher: Fetcher, importId: string, signal?: AbortSignal) {
  return requestJson({
    schema: importTaskSchema,
    input: `/api/imports/${importId}`,
    init: signal ? { signal } : {},
    fetcher,
  });
}

export async function cancelImport(fetcher: Fetcher, importId: string): Promise<void> {
  const response = await fetcher(`/api/imports/${importId}/cancel`, {
    method: 'POST',
    headers: createRequestHeaders(),
  });
  if (!response.ok) throw new Error(`CANCEL_HTTP_${response.status}`);
}

export function uploadFile(
  ticket: UploadTicket,
  file: File,
  accessToken: string,
  onProgress: (progress: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('PUT', `/api${ticket.uploadPath}`);
    for (const [name, value] of createRequestHeaders({
      authorization: `Bearer ${accessToken}`,
      'content-type': file.type || 'application/octet-stream',
    })) {
      request.setRequestHeader(name, value);
    }
    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    });
    request.addEventListener('load', () => {
      if (request.status >= 200 && request.status < 300) resolve();
      else reject(new Error(`UPLOAD_HTTP_${request.status}`));
    });
    request.addEventListener('error', () => reject(new Error('UPLOAD_NETWORK_ERROR')));
    request.addEventListener('abort', () => reject(new Error('UPLOAD_CANCELLED')));
    request.send(file);
  });
}

export const uploadResponseSchema = z.object({ status: z.literal('QUEUED') });
