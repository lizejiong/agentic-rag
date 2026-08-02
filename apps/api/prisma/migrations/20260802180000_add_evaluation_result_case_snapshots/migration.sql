ALTER TABLE "app"."evaluation_run_results"
  ADD COLUMN "reference_answer" TEXT,
  ADD COLUMN "expected_evidence" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "expected_answer_points" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

UPDATE "app"."evaluation_run_results" AS result
SET
  "reference_answer" = evaluation_case."reference_answer",
  "expected_evidence" = evaluation_case."expected_evidence",
  "expected_answer_points" = evaluation_case."expected_answer_points"
FROM "app"."evaluation_cases" AS evaluation_case
WHERE result."case_id" = evaluation_case."id";
