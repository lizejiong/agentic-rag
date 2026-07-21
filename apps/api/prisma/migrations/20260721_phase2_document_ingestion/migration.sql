-- CreateEnum
CREATE TYPE "app"."DocumentSourceType" AS ENUM ('FILE', 'URL');

-- CreateEnum
CREATE TYPE "app"."DocumentProcessingStatus" AS ENUM ('PENDING_UPLOAD', 'QUEUED', 'SECURITY_CHECK', 'PARSING', 'NORMALIZING', 'CHUNKING', 'READY', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "app"."ImportTaskStatus" AS ENUM ('PENDING_UPLOAD', 'QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- AlterTable
ALTER TABLE "app"."documents"
ADD COLUMN "source_type" "app"."DocumentSourceType" NOT NULL DEFAULT 'FILE',
ADD COLUMN "active_version_id" UUID,
ADD COLUMN "created_by_id" UUID,
ADD COLUMN "deleted_at" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "app"."stored_objects" (
    "id" UUID NOT NULL,
    "content_hash" CHAR(64) NOT NULL,
    "bucket" VARCHAR(120) NOT NULL,
    "object_key" VARCHAR(1024) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "detected_mime_type" VARCHAR(160) NOT NULL,
    "ref_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "stored_objects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."document_versions" (
    "id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "source_type" "app"."DocumentSourceType" NOT NULL,
    "source_url" VARCHAR(2048),
    "original_file_name" VARCHAR(255) NOT NULL,
    "file_extension" VARCHAR(16) NOT NULL,
    "declared_mime_type" VARCHAR(160) NOT NULL,
    "detected_mime_type" VARCHAR(160),
    "size_bytes" INTEGER,
    "content_hash" CHAR(64),
    "stored_object_id" UUID,
    "processing_status" "app"."DocumentProcessingStatus" NOT NULL DEFAULT 'PENDING_UPLOAD',
    "parser_version" VARCHAR(120),
    "processing_strategy" VARCHAR(120),
    "error_code" VARCHAR(120),
    "error_message" TEXT,
    "created_by_id" UUID NOT NULL,
    "published_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "document_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."import_tasks" (
    "id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "status" "app"."ImportTaskStatus" NOT NULL DEFAULT 'PENDING_UPLOAD',
    "stage" "app"."DocumentProcessingStatus" NOT NULL DEFAULT 'PENDING_UPLOAD',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "quarantine_object_key" VARCHAR(1024),
    "request_id" VARCHAR(120) NOT NULL,
    "trace_id" VARCHAR(120) NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "error_code" VARCHAR(120),
    "error_message" TEXT,
    "created_by_id" UUID NOT NULL,
    "started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "import_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "documents_active_version_id_key" ON "app"."documents"("active_version_id");
CREATE INDEX "documents_created_by_id_idx" ON "app"."documents"("created_by_id");
CREATE INDEX "documents_deleted_at_idx" ON "app"."documents"("deleted_at");
CREATE UNIQUE INDEX "stored_objects_content_hash_key" ON "app"."stored_objects"("content_hash");
CREATE UNIQUE INDEX "stored_objects_object_key_key" ON "app"."stored_objects"("object_key");
CREATE INDEX "stored_objects_ref_count_idx" ON "app"."stored_objects"("ref_count");
CREATE UNIQUE INDEX "document_versions_document_id_version_number_key" ON "app"."document_versions"("document_id", "version_number");
CREATE INDEX "document_versions_document_id_processing_status_idx" ON "app"."document_versions"("document_id", "processing_status");
CREATE INDEX "document_versions_content_hash_idx" ON "app"."document_versions"("content_hash");
CREATE INDEX "document_versions_stored_object_id_idx" ON "app"."document_versions"("stored_object_id");
CREATE INDEX "document_versions_created_by_id_idx" ON "app"."document_versions"("created_by_id");
CREATE UNIQUE INDEX "import_tasks_version_id_key" ON "app"."import_tasks"("version_id");
CREATE INDEX "import_tasks_document_id_created_at_idx" ON "app"."import_tasks"("document_id", "created_at");
CREATE INDEX "import_tasks_status_updated_at_idx" ON "app"."import_tasks"("status", "updated_at");
CREATE INDEX "import_tasks_created_by_id_idx" ON "app"."import_tasks"("created_by_id");

-- AddForeignKey
ALTER TABLE "app"."documents" ADD CONSTRAINT "documents_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "app"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "app"."document_versions" ADD CONSTRAINT "document_versions_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "app"."documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "app"."document_versions" ADD CONSTRAINT "document_versions_stored_object_id_fkey" FOREIGN KEY ("stored_object_id") REFERENCES "app"."stored_objects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "app"."document_versions" ADD CONSTRAINT "document_versions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "app"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "app"."documents" ADD CONSTRAINT "documents_active_version_id_fkey" FOREIGN KEY ("active_version_id") REFERENCES "app"."document_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "app"."import_tasks" ADD CONSTRAINT "import_tasks_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "app"."documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "app"."import_tasks" ADD CONSTRAINT "import_tasks_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "app"."document_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "app"."import_tasks" ADD CONSTRAINT "import_tasks_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "app"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
