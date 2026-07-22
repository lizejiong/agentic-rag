import { describe, expect, it } from 'vitest';

import {
  createFileImportsSchema,
  createUrlImportSchema,
  documentIngestionRequestedPayloadSchema,
  documentUrlCaptureRequestedPayloadSchema,
  fileImportMetadataSchema,
} from '../src/document-import';

const file = {
  clientFileId: '16a73536-e90a-44a7-9bb1-b71d424f3b37',
  fileName: '产品手册.pdf',
  sizeBytes: 1024,
  mimeType: 'application/pdf',
};

describe('document import contracts', () => {
  it('accepts a valid file batch', () => {
    expect(createFileImportsSchema.parse({ files: [file] })).toEqual({ files: [file] });
  });

  it('rejects batches larger than 100 files', () => {
    const files = Array.from({ length: 101 }, (_, index) => ({
      ...file,
      clientFileId: `00000000-0000-4000-8000-${index.toString().padStart(12, '0')}`,
    }));

    expect(createFileImportsSchema.safeParse({ files }).success).toBe(false);
  });

  it('rejects duplicate client file identifiers in one batch', () => {
    expect(createFileImportsSchema.safeParse({ files: [file, file] }).success).toBe(false);
  });

  it('rejects a file above the 200 MiB protocol ceiling', () => {
    expect(
      fileImportMetadataSchema.safeParse({
        ...file,
        sizeBytes: 200 * 1024 * 1024 + 1,
      }).success,
    ).toBe(false);
  });

  it('validates an ingestion command payload', () => {
    const result = documentIngestionRequestedPayloadSchema.safeParse({
      documentId: '1c0078c7-5818-4527-966b-e0663c476374',
      spaceId: 'b7b7cbbd-0d42-40dc-9895-86f7859166ea',
      versionId: 'd57d4f96-82f4-454b-a101-071fcde1f119',
      importId: '89321158-2038-4b7f-a20c-ea92e6b4090c',
      objectKey: 'quarantine/89321158-2038-4b7f-a20c-ea92e6b4090c',
      contentHash: 'a'.repeat(64),
      sizeBytes: 1024,
      declaredMimeType: 'application/pdf',
      originalFileName: '产品手册.pdf',
      actorId: '806fcb79-225b-4ca5-bb67-f94a5b66d9c4',
      aclSnapshot: {
        spaceId: 'b7b7cbbd-0d42-40dc-9895-86f7859166ea',
        documentSubjects: [],
      },
    });

    expect(result.success).toBe(true);
  });

  it('accepts a strict public URL import request shape', () => {
    expect(createUrlImportSchema.parse({ url: 'https://example.com/guide' })).toEqual({
      url: 'https://example.com/guide',
    });
    expect(
      createUrlImportSchema.safeParse({ url: 'https://example.com', unexpected: true }).success,
    ).toBe(false);
  });

  it('validates a URL capture command payload', () => {
    expect(
      documentUrlCaptureRequestedPayloadSchema.safeParse({
        documentId: '1c0078c7-5818-4527-966b-e0663c476374',
        spaceId: 'b7b7cbbd-0d42-40dc-9895-86f7859166ea',
        versionId: 'd57d4f96-82f4-454b-a101-071fcde1f119',
        importId: '89321158-2038-4b7f-a20c-ea92e6b4090c',
        sourceUrl: 'https://example.com/guide',
        actorId: '806fcb79-225b-4ca5-bb67-f94a5b66d9c4',
        aclSnapshot: {
          spaceId: 'b7b7cbbd-0d42-40dc-9895-86f7859166ea',
          documentSubjects: [],
        },
      }).success,
    ).toBe(true);
  });
});
