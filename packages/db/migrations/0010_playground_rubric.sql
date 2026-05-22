ALTER TABLE "playground_agent_runs"
  ADD COLUMN "score_correctness" smallint,
  ADD COLUMN "score_code_quality" smallint,
  ADD COLUMN "score_ux" smallint,
  ADD COLUMN "score_ship_it" smallint,
  ADD COLUMN "file_count" integer,
  ADD COLUMN "loc" integer;

CREATE TABLE "playground_autograder_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "session_id" uuid NOT NULL REFERENCES "playground_sessions"("id") ON DELETE CASCADE,
  "grader_model_id" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "latency_ms" integer,
  "usd_cost" numeric(10, 4),
  "error_message" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "finished_at" timestamptz
);

CREATE INDEX "playground_autograder_runs_session_idx"
  ON "playground_autograder_runs" ("session_id");

CREATE TABLE "playground_autograder_scores" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "autograder_run_id" uuid NOT NULL REFERENCES "playground_autograder_runs"("id") ON DELETE CASCADE,
  "agent_run_id" uuid NOT NULL REFERENCES "playground_agent_runs"("id") ON DELETE CASCADE,
  "overall" integer,
  "correctness" smallint,
  "code_quality" smallint,
  "ux" smallint,
  "ship_it" smallint,
  "rationale" text
);

CREATE INDEX "playground_autograder_scores_run_idx"
  ON "playground_autograder_scores" ("autograder_run_id");

CREATE INDEX "playground_autograder_scores_agent_run_idx"
  ON "playground_autograder_scores" ("agent_run_id");
