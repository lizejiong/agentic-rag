import {
  createFileImportsResponseSchema,
  createUrlImportResponseSchema,
  documentSummarySchema,
  importTaskSchema,
} from '@rag/contracts';
import { z } from 'zod';

export const documentListSchema = z.array(documentSummarySchema);
export { createFileImportsResponseSchema, createUrlImportResponseSchema, importTaskSchema };

export type DocumentListItem = z.infer<typeof documentSummarySchema>;
export type UploadTicket = z.infer<typeof createFileImportsResponseSchema>['imports'][number];
export type ImportTask = z.infer<typeof importTaskSchema>;
export type UrlImportTicket = z.infer<typeof createUrlImportResponseSchema>;
