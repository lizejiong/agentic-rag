import { z } from 'zod';

export const supportedDocumentExtensionSchema = z.enum([
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

export const documentSourceTypeSchema = z.enum(['FILE', 'URL']);
export const documentAvailabilitySchema = z.enum(['DRAFT', 'ACTIVE', 'INACTIVE', 'SOFT_DELETED']);
export const documentProcessingStatusSchema = z.enum([
  'PENDING_UPLOAD',
  'QUEUED',
  'SECURITY_CHECK',
  'PARSING',
  'NORMALIZING',
  'CHUNKING',
  'READY',
  'FAILED',
  'CANCELLED',
]);
export const importTaskStatusSchema = z.enum([
  'PENDING_UPLOAD',
  'QUEUED',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
]);

export const fileImportMetadataSchema = z
  .object({
    clientFileId: z.string().uuid(),
    fileName: z.string().trim().min(1).max(255),
    sizeBytes: z
      .int()
      .positive()
      .max(200 * 1024 * 1024),
    mimeType: z.string().trim().min(1).max(160),
  })
  .strict();

export const createFileImportsSchema = z
  .object({
    files: z.array(fileImportMetadataSchema).min(1).max(100),
  })
  .strict()
  .superRefine((input, context) => {
    const clientFileIds = new Set<string>();
    input.files.forEach((file, index) => {
      if (clientFileIds.has(file.clientFileId)) {
        context.addIssue({
          code: 'custom',
          path: ['files', index, 'clientFileId'],
          message: 'clientFileId must be unique within a batch.',
        });
      }
      clientFileIds.add(file.clientFileId);
    });
  });

export const fileImportTicketSchema = z
  .object({
    clientFileId: z.string().uuid(),
    documentId: z.string().uuid(),
    versionId: z.string().uuid(),
    importId: z.string().uuid(),
    uploadPath: z.string().startsWith('/imports/'),
  })
  .strict();

export const createFileImportsResponseSchema = z
  .object({
    imports: z.array(fileImportTicketSchema).min(1).max(100),
  })
  .strict();

export const documentVersionSchema = z
  .object({
    id: z.string().uuid(),
    documentId: z.string().uuid(),
    versionNumber: z.int().positive(),
    sourceType: documentSourceTypeSchema,
    originalFileName: z.string().min(1),
    declaredMimeType: z.string().min(1),
    detectedMimeType: z.string().nullable(),
    sizeBytes: z.int().nonnegative().nullable(),
    contentHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    processingStatus: documentProcessingStatusSchema,
    errorCode: z.string().nullable(),
    errorMessage: z.string().nullable(),
    publishedAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
  })
  .strict();

export const importTaskSchema = z
  .object({
    id: z.string().uuid(),
    documentId: z.string().uuid(),
    versionId: z.string().uuid(),
    status: importTaskStatusSchema,
    stage: documentProcessingStatusSchema,
    progress: z.int().min(0).max(100),
    attempt: z.int().nonnegative(),
    errorCode: z.string().nullable(),
    errorMessage: z.string().nullable(),
    startedAt: z.string().datetime().nullable(),
    completedAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export const documentSummarySchema = z
  .object({
    id: z.string().uuid(),
    spaceId: z.string().uuid(),
    title: z.string().min(1),
    sourceType: documentSourceTypeSchema,
    availability: documentAvailabilitySchema,
    activeVersionId: z.string().uuid().nullable(),
    latestVersion: documentVersionSchema.nullable(),
    latestImport: importTaskSchema.nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

const ingestionEventBaseSchema = z
  .object({
    documentId: z.string().uuid(),
    spaceId: z.string().uuid(),
    versionId: z.string().uuid(),
    importId: z.string().uuid(),
  })
  .strict();

export const documentIngestionRequestedPayloadSchema = ingestionEventBaseSchema
  .extend({
    objectKey: z.string().min(1),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    sizeBytes: z.int().positive(),
    declaredMimeType: z.string().min(1),
    originalFileName: z.string().min(1),
    actorId: z.string().uuid(),
  })
  .strict();

export const documentIngestionProgressedPayloadSchema = ingestionEventBaseSchema
  .extend({
    stage: documentProcessingStatusSchema.exclude([
      'PENDING_UPLOAD',
      'READY',
      'FAILED',
      'CANCELLED',
    ]),
    progress: z.int().min(0).max(99),
  })
  .strict();

export const documentIngestionCompletedPayloadSchema = ingestionEventBaseSchema
  .extend({
    normalizedDocumentId: z.string().uuid(),
    chunkCount: z.int().nonnegative(),
    detectedMimeType: z.string().min(1),
    parserVersion: z.string().min(1),
  })
  .strict();

export const documentIngestionFailedPayloadSchema = ingestionEventBaseSchema
  .extend({
    stage: documentProcessingStatusSchema.exclude(['READY']),
    code: z.string().min(1).max(120),
    message: z.string().min(1).max(1000),
    retryable: z.boolean(),
  })
  .strict();

export const documentIngestionEventTypeSchema = z.enum([
  'document.ingestion.requested.v1',
  'document.ingestion.progressed.v1',
  'document.ingestion.completed.v1',
  'document.ingestion.failed.v1',
]);

export type CreateFileImports = z.infer<typeof createFileImportsSchema>;
export type CreateFileImportsResponse = z.infer<typeof createFileImportsResponseSchema>;
export type DocumentSummary = z.infer<typeof documentSummarySchema>;
export type DocumentVersion = z.infer<typeof documentVersionSchema>;
export type ImportTask = z.infer<typeof importTaskSchema>;
export type DocumentIngestionRequestedPayload = z.infer<
  typeof documentIngestionRequestedPayloadSchema
>;
export type DocumentIngestionProgressedPayload = z.infer<
  typeof documentIngestionProgressedPayloadSchema
>;
export type DocumentIngestionCompletedPayload = z.infer<
  typeof documentIngestionCompletedPayloadSchema
>;
export type DocumentIngestionFailedPayload = z.infer<typeof documentIngestionFailedPayloadSchema>;
