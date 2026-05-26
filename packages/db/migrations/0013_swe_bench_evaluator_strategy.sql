-- New per-case strategy that decides how solutions get scored at benchmark
-- time: deterministic fail-to-pass/pass-to-pass tests, or an in-sandbox Pi
-- evaluator agent comparing each agent's worktree to the gold patch.
CREATE TYPE "evaluator_strategy" AS ENUM ('deterministic_tests', 'llm_evaluator_only');

ALTER TABLE "case_versions"
  ADD COLUMN "evaluator_strategy" "evaluator_strategy";

CREATE INDEX "case_versions_evaluator_strategy_idx"
  ON "case_versions" ("evaluator_strategy");

-- Backfill: cases that already have any accepted test_specs are treated as
-- deterministic. Everything else is left NULL until test-gen runs.
UPDATE "case_versions" cv
  SET "evaluator_strategy" = 'deterministic_tests'
  WHERE EXISTS (
    SELECT 1 FROM "test_specs" ts
      WHERE ts."case_version_id" = cv."id" AND ts."status" = 'accepted'
  );

-- Shared E2B sandbox id per experiment so the admin UI can surface it.
ALTER TABLE "experiments"
  ADD COLUMN "sandbox_id" text;

-- When the Pi-evaluator scores a set of benchmark runs, we record the
-- evaluator's own run row and link the scored runs to it. Self-FK on `runs`.
ALTER TABLE "runs"
  ADD COLUMN "evaluator_run_id" uuid
    REFERENCES "runs"("id") ON DELETE SET NULL;

CREATE INDEX "runs_evaluator_run_id_idx" ON "runs" ("evaluator_run_id");

-- reproduction_steps is folded into the LLM-evaluator strategy. Drop the
-- table, the type, and the unused enum value on validation_strategy.
DELETE FROM "validation_attempts" WHERE "strategy" = 'reproduction_steps';
DROP TABLE IF EXISTS "reproduction_steps";
DROP TYPE IF EXISTS "reproduction_step_status";

CREATE TYPE "validation_strategy_new" AS ENUM ('unit_tests');
ALTER TABLE "validation_attempts"
  ALTER COLUMN "strategy" DROP DEFAULT,
  ALTER COLUMN "strategy" TYPE "validation_strategy_new"
    USING "strategy"::text::"validation_strategy_new",
  ALTER COLUMN "strategy" SET DEFAULT 'unit_tests';
DROP TYPE "validation_strategy";
ALTER TYPE "validation_strategy_new" RENAME TO "validation_strategy";
