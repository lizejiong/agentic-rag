import { z } from 'zod';

import type { Fetcher } from '../../shared/api/request-json';
import { createRequestHeaders, requestJson } from '../../shared/api/request-json';
import {
  createFileImportsResponseSchema,
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
