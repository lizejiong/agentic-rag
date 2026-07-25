import {
  createFileImportsResponseSchema,
  createUrlImportResponseSchema,
  documentDetailSchema,
  documentSummarySchema,
  importTaskSchema,
} from '@rag/contracts';
import { z } from 'zod';

export const documentListSchema = z.array(documentSummarySchema);
export {
  createFileImportsResponseSchema,
  createUrlImportResponseSchema,
  documentDetailSchema,
  importTaskSchema,
};

export type DocumentListItem = z.infer<typeof documentSummarySchema>;
export type DocumentDetail = z.infer<typeof documentDetailSchema>;
export type UploadTicket = z.infer<typeof createFileImportsResponseSchema>['imports'][number];
export type ImportTask = z.infer<typeof importTaskSchema>;
export type UrlImportTicket = z.infer<typeof createUrlImportResponseSchema>;
