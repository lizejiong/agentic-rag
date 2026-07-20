-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "app";

-- CreateEnum
CREATE TYPE "app"."SystemRole" AS ENUM ('ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "app"."UserStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "app"."SpaceStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "app"."SpacePermission" AS ENUM ('VIEW', 'EDIT', 'MANAGE');

-- CreateEnum
CREATE TYPE "app"."SubjectType" AS ENUM ('USER', 'DEPARTMENT', 'GROUP');

-- CreateEnum
CREATE TYPE "app"."DocumentAvailability" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE', 'SOFT_DELETED');

-- CreateEnum
CREATE TYPE "app"."EgressPolicy" AS ENUM ('LOCAL_ONLY', 'REDACTED_CLOUD', 'CLOUD_ALLOWED');

-- CreateEnum
CREATE TYPE "app"."AuditResult" AS ENUM ('SUCCESS', 'DENIED', 'FAILED');

-- CreateEnum
CREATE TYPE "app"."OutboxStatus" AS ENUM ('PENDING', 'PUBLISHED', 'FAILED');

-- CreateTable
CREATE TABLE "app"."users" (
    "id" UUID NOT NULL,
    "username" VARCHAR(80) NOT NULL,
    "displayName" VARCHAR(120) NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "app"."SystemRole" NOT NULL DEFAULT 'MEMBER',
    "status" "app"."UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "department_id" UUID,
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(3),
    "token_version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."departments" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."groups" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."group_members" (
    "group_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "group_members_pkey" PRIMARY KEY ("group_id","user_id")
);

-- CreateTable
CREATE TABLE "app"."knowledge_spaces" (
    "id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "description" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "default_language" VARCHAR(20) NOT NULL DEFAULT 'zh-CN',
    "egress_policy" "app"."EgressPolicy" NOT NULL DEFAULT 'LOCAL_ONLY',
    "llm_enabled" BOOLEAN NOT NULL DEFAULT true,
    "embedding_enabled" BOOLEAN NOT NULL DEFAULT true,
    "reranker_enabled" BOOLEAN NOT NULL DEFAULT true,
    "asr_enabled" BOOLEAN NOT NULL DEFAULT true,
    "tts_enabled" BOOLEAN NOT NULL DEFAULT true,
    "graph_extraction_enabled" BOOLEAN NOT NULL DEFAULT false,
    "status" "app"."SpaceStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "knowledge_spaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."space_grants" (
    "id" UUID NOT NULL,
    "space_id" UUID NOT NULL,
    "subject_type" "app"."SubjectType" NOT NULL,
    "subject_id" UUID NOT NULL,
    "permission" "app"."SpacePermission" NOT NULL,
    "expires_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "space_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."documents" (
    "id" UUID NOT NULL,
    "space_id" UUID NOT NULL,
    "title" VARCHAR(300) NOT NULL,
    "availability" "app"."DocumentAvailability" NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."document_acl_entries" (
    "id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "subject_type" "app"."SubjectType" NOT NULL,
    "subject_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_acl_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."refresh_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "family_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "last_used_at" TIMESTAMPTZ(3),
    "user_agent_hash" CHAR(64),
    "ip_hash" CHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."authorization_state" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "revision" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "authorization_state_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."audit_logs" (
    "id" UUID NOT NULL,
    "actor_id" UUID,
    "actor_username" VARCHAR(80),
    "action" VARCHAR(120) NOT NULL,
    "target_type" VARCHAR(80) NOT NULL,
    "target_id" VARCHAR(120),
    "result" "app"."AuditResult" NOT NULL,
    "source_ip" VARCHAR(64),
    "request_id" VARCHAR(120) NOT NULL,
    "trace_id" VARCHAR(120) NOT NULL,
    "reason" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."outbox_events" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "type" VARCHAR(160) NOT NULL,
    "task_id" UUID,
    "resource_id" VARCHAR(120) NOT NULL,
    "resource_version" INTEGER NOT NULL DEFAULT 1,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "trace_id" VARCHAR(120) NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "app"."OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMPTZ(3),
    "error_code" VARCHAR(120),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."processed_events" (
    "event_id" UUID NOT NULL,
    "consumer" VARCHAR(120) NOT NULL,
    "processed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processed_events_pkey" PRIMARY KEY ("event_id","consumer")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "app"."users"("username");

-- CreateIndex
CREATE INDEX "users_department_id_idx" ON "app"."users"("department_id");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "app"."users"("status");

-- CreateIndex
CREATE UNIQUE INDEX "departments_name_key" ON "app"."departments"("name");

-- CreateIndex
CREATE UNIQUE INDEX "groups_name_key" ON "app"."groups"("name");

-- CreateIndex
CREATE INDEX "group_members_user_id_idx" ON "app"."group_members"("user_id");

-- CreateIndex
CREATE INDEX "knowledge_spaces_status_idx" ON "app"."knowledge_spaces"("status");

-- CreateIndex
CREATE INDEX "knowledge_spaces_created_by_id_idx" ON "app"."knowledge_spaces"("created_by_id");

-- CreateIndex
CREATE INDEX "space_grants_subject_type_subject_id_idx" ON "app"."space_grants"("subject_type", "subject_id");

-- CreateIndex
CREATE UNIQUE INDEX "space_grants_space_id_subject_type_subject_id_key" ON "app"."space_grants"("space_id", "subject_type", "subject_id");

-- CreateIndex
CREATE INDEX "documents_space_id_availability_idx" ON "app"."documents"("space_id", "availability");

-- CreateIndex
CREATE INDEX "document_acl_entries_subject_type_subject_id_idx" ON "app"."document_acl_entries"("subject_type", "subject_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_acl_entries_document_id_subject_type_subject_id_key" ON "app"."document_acl_entries"("document_id", "subject_type", "subject_id");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_sessions_token_hash_key" ON "app"."refresh_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_sessions_user_id_revoked_at_idx" ON "app"."refresh_sessions"("user_id", "revoked_at");

-- CreateIndex
CREATE INDEX "refresh_sessions_family_id_idx" ON "app"."refresh_sessions"("family_id");

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_created_at_idx" ON "app"."audit_logs"("actor_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_target_type_target_id_created_at_idx" ON "app"."audit_logs"("target_type", "target_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_request_id_idx" ON "app"."audit_logs"("request_id");

-- CreateIndex
CREATE UNIQUE INDEX "outbox_events_event_id_key" ON "app"."outbox_events"("event_id");

-- CreateIndex
CREATE INDEX "outbox_events_status_next_attempt_at_idx" ON "app"."outbox_events"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "outbox_events_resource_id_resource_version_idx" ON "app"."outbox_events"("resource_id", "resource_version");

-- AddForeignKey
ALTER TABLE "app"."users" ADD CONSTRAINT "users_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "app"."departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."group_members" ADD CONSTRAINT "group_members_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "app"."groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."group_members" ADD CONSTRAINT "group_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."knowledge_spaces" ADD CONSTRAINT "knowledge_spaces_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "app"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."space_grants" ADD CONSTRAINT "space_grants_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "app"."knowledge_spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."documents" ADD CONSTRAINT "documents_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "app"."knowledge_spaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."document_acl_entries" ADD CONSTRAINT "document_acl_entries_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "app"."documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."refresh_sessions" ADD CONSTRAINT "refresh_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
