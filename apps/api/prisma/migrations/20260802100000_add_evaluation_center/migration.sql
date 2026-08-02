-- CreateEnum
CREATE TYPE "app"."EvaluationRunMode" AS ENUM ('RETRIEVAL', 'FULL');

-- CreateEnum
CREATE TYPE "app"."EvaluationRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "app"."evaluation_datasets" (
    "id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "description" TEXT,
    "space_id" UUID NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "evaluation_datasets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."evaluation_cases" (
    "id" UUID NOT NULL,
    "dataset_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "question" TEXT NOT NULL,
    "reference_answer" TEXT NOT NULL,
    "expected_evidence" JSONB NOT NULL,
    "expected_answer_points" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "expect_no_answer" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "evaluation_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."evaluation_runs" (
    "id" UUID NOT NULL,
    "dataset_id" UUID NOT NULL,
    "space_id" UUID NOT NULL,
    "created_by_id" UUID NOT NULL,
    "mode" "app"."EvaluationRunMode" NOT NULL,
    "status" "app"."EvaluationRunStatus" NOT NULL DEFAULT 'RUNNING',
    "summary" JSONB,
    "error" TEXT,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evaluation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."evaluation_run_results" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "case_id" UUID,
    "position" INTEGER NOT NULL,
    "question" TEXT NOT NULL,
    "effective_query" TEXT NOT NULL,
    "expect_no_answer" BOOLEAN NOT NULL DEFAULT false,
    "stages" JSONB NOT NULL,
    "trace" JSONB NOT NULL,
    "answer" TEXT,
    "citations" JSONB,
    "answer_point_coverage" DOUBLE PRECISION,
    "citation_evidence_precision" DOUBLE PRECISION,
    "refusal_correct" BOOLEAN,
    "error" TEXT,
    "elapsed_ms" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "evaluation_run_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "evaluation_datasets_space_id_idx" ON "app"."evaluation_datasets"("space_id");

-- CreateIndex
CREATE INDEX "evaluation_datasets_created_by_id_idx" ON "app"."evaluation_datasets"("created_by_id");

-- CreateIndex
CREATE INDEX "evaluation_cases_dataset_id_idx" ON "app"."evaluation_cases"("dataset_id");

-- CreateIndex
CREATE UNIQUE INDEX "evaluation_cases_dataset_id_position_key" ON "app"."evaluation_cases"("dataset_id", "position");

-- CreateIndex
CREATE INDEX "evaluation_runs_dataset_id_created_at_idx" ON "app"."evaluation_runs"("dataset_id", "created_at");

-- CreateIndex
CREATE INDEX "evaluation_runs_space_id_idx" ON "app"."evaluation_runs"("space_id");

-- CreateIndex
CREATE INDEX "evaluation_run_results_case_id_idx" ON "app"."evaluation_run_results"("case_id");

-- CreateIndex
CREATE UNIQUE INDEX "evaluation_run_results_run_id_position_key" ON "app"."evaluation_run_results"("run_id", "position");

-- AddForeignKey
ALTER TABLE "app"."evaluation_datasets" ADD CONSTRAINT "evaluation_datasets_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "app"."knowledge_spaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."evaluation_datasets" ADD CONSTRAINT "evaluation_datasets_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "app"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."evaluation_cases" ADD CONSTRAINT "evaluation_cases_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "app"."evaluation_datasets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."evaluation_runs" ADD CONSTRAINT "evaluation_runs_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "app"."evaluation_datasets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."evaluation_runs" ADD CONSTRAINT "evaluation_runs_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "app"."knowledge_spaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."evaluation_runs" ADD CONSTRAINT "evaluation_runs_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "app"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."evaluation_run_results" ADD CONSTRAINT "evaluation_run_results_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "app"."evaluation_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."evaluation_run_results" ADD CONSTRAINT "evaluation_run_results_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "app"."evaluation_cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;
