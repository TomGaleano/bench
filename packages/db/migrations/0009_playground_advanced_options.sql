ALTER TABLE "playground_sessions"
  ADD COLUMN "max_wall_clock_seconds" integer,
  ADD COLUMN "max_output_tokens_per_agent" integer,
  ADD COLUMN "tools" text[],
  ADD COLUMN "sandbox_image" text,
  ADD COLUMN "seed_prompt_text" text,
  ADD COLUMN "run_twice_and_average" boolean NOT NULL DEFAULT false;

ALTER TABLE "playground_agent_runs"
  ADD COLUMN "parent_agent_run_id" uuid,
  ADD COLUMN "cancellation_reason" text;

ALTER TABLE "playground_agent_runs"
  ADD CONSTRAINT "playground_agent_runs_parent_fk"
  FOREIGN KEY ("parent_agent_run_id") REFERENCES "playground_agent_runs"("id") ON DELETE SET NULL;

CREATE INDEX "playground_agent_runs_parent_idx"
  ON "playground_agent_runs" ("parent_agent_run_id")
  WHERE "parent_agent_run_id" IS NOT NULL;
