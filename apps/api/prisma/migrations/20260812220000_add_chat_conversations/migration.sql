CREATE TYPE "app"."ChatTurnStatus" AS ENUM ('RUNNING', 'COMPLETED', 'CANCELLED', 'FAILED');

CREATE TABLE "app"."chat_conversations" (
  "id" UUID NOT NULL,
  "owner_id" UUID NOT NULL,
  "title" VARCHAR(120) NOT NULL DEFAULT '新会话',
  "archived_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "chat_conversations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "app"."chat_turns" (
  "id" UUID NOT NULL,
  "conversation_id" UUID NOT NULL,
  "request_id" UUID NOT NULL,
  "actor_id" UUID NOT NULL,
  "trace_id" VARCHAR(120) NOT NULL,
  "question" TEXT NOT NULL,
  "scope_space_ids" UUID[] NOT NULL,
  "status" "app"."ChatTurnStatus" NOT NULL DEFAULT 'RUNNING',
  "answer" TEXT,
  "citations" JSONB NOT NULL DEFAULT '[]',
  "error_code" VARCHAR(120),
  "completed_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "chat_turns_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "chat_turns_request_id_key" ON "app"."chat_turns"("request_id");
CREATE INDEX "chat_conversations_owner_id_archived_at_updated_at_idx" ON "app"."chat_conversations"("owner_id", "archived_at", "updated_at" DESC);
CREATE INDEX "chat_turns_conversation_id_created_at_idx" ON "app"."chat_turns"("conversation_id", "created_at");
CREATE INDEX "chat_turns_actor_id_created_at_idx" ON "app"."chat_turns"("actor_id", "created_at");
CREATE INDEX "chat_turns_scope_space_ids_idx" ON "app"."chat_turns" USING GIN ("scope_space_ids");

ALTER TABLE "app"."chat_conversations"
  ADD CONSTRAINT "chat_conversations_owner_id_fkey"
  FOREIGN KEY ("owner_id") REFERENCES "app"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "app"."chat_turns"
  ADD CONSTRAINT "chat_turns_conversation_id_fkey"
  FOREIGN KEY ("conversation_id") REFERENCES "app"."chat_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "chat_turns_actor_id_fkey"
  FOREIGN KEY ("actor_id") REFERENCES "app"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
