import { extname } from 'node:path';

import { BadRequestException } from '@nestjs/common';
import {
  createFileImportsSchema,
  createUrlImportSchema,
  supportedDocumentExtensionSchema,
  type CreateFileImports,
  type CreateUrlImport,
} from '@rag/contracts';

const MEBIBYTE = 1024 * 1024;
const TEXT_EXTENSIONS = new Set(['txt', 'md', 'csv', 'json']);

export function parseCreateFileImports(input: unknown): CreateFileImports {
  const result = createFileImportsSchema.safeParse(input);
  if (!result.success) {
    throw new BadRequestException('INVALID_FILE_IMPORT_REQUEST');
  }
  for (const file of result.data.files) {
    validateImportFile(file.fileName, file.sizeBytes);
  }
  return result.data;
}

export function parseCreateUrlImport(input: unknown): CreateUrlImport {
  const result = createUrlImportSchema.safeParse(input);
  if (!result.success) {
    throw new BadRequestException('INVALID_URL_IMPORT_REQUEST');
  }
  const url = new URL(result.data.url);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new BadRequestException('INVALID_URL_IMPORT_REQUEST');
  }
  url.hash = '';
  return { url: url.toString() };
}

export function validateImportFile(
  fileName: string,
  sizeBytes: number,
): { extension: string; maxBytes: number } {
  const extension = extname(fileName).slice(1).toLowerCase();
  const parsedExtension = supportedDocumentExtensionSchema.safeParse(extension);
  if (!parsedExtension.success) {
    throw new BadRequestException('UNSUPPORTED_DOCUMENT_FORMAT');
  }
  const maxBytes = TEXT_EXTENSIONS.has(parsedExtension.data) ? 100 * MEBIBYTE : 200 * MEBIBYTE;
  if (sizeBytes <= 0 || sizeBytes > maxBytes) {
    throw new BadRequestException('DOCUMENT_SIZE_LIMIT_EXCEEDED');
  }
  return { extension: parsedExtension.data, maxBytes };
}
