import { allowedExtensions } from './documents-api';
import type { UploadTicket } from './document-contract';

const MEBIBYTE = 1024 * 1024;
const textExtensions = new Set(['txt', 'md', 'csv', 'json']);

export type UploadRow = {
  id: string;
  file: File;
  progress: number;
  status: 'waiting' | 'uploading' | 'queued' | 'failed' | 'cancelled';
  ticket?: UploadTicket;
  error: string | undefined;
};

export function validateSelectedFiles(files: File[]): string | undefined {
  if (files.length === 0) return '请选择至少一个文件。';
  if (files.length > 100) return '单次最多导入 100 个文件。';
  for (const file of files) {
    const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
    if (!allowedExtensions.has(extension)) return `${file.name}：不支持该格式。`;
    const maxBytes = (textExtensions.has(extension) ? 100 : 200) * MEBIBYTE;
    if (file.size <= 0 || file.size > maxBytes) return `${file.name}：文件大小超出限制。`;
  }
  return undefined;
}

export async function runWithConcurrency<T>(
  values: T[],
  limit: number,
  operation: (value: T, index: number) => Promise<void>,
): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < values.length) {
      const index = next++;
      await operation(values[index] as T, index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker));
}
