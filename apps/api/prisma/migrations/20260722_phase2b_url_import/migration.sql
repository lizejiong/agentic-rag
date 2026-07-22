ALTER TYPE "app"."DocumentProcessingStatus" ADD VALUE IF NOT EXISTS 'FETCHING' BEFORE 'QUEUED';

ALTER TABLE "app"."document_versions"
  ADD COLUMN "resolved_url" VARCHAR(2048),
  ADD COLUMN "canonical_url" VARCHAR(2048),
  ADD COLUMN "source_author" VARCHAR(500),
  ADD COLUMN "source_published_at" TIMESTAMPTZ(3),
  ADD COLUMN "source_fetched_at" TIMESTAMPTZ(3),
  ADD COLUMN "source_checked_at" TIMESTAMPTZ(3);

CREATE INDEX "document_versions_source_url_idx"
  ON "app"."document_versions"("source_url");
