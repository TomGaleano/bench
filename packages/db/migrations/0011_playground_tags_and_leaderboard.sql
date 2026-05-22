ALTER TABLE "playground_sessions"
  ADD COLUMN "title" text,
  ADD COLUMN "tags" text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN "share_token" text;

CREATE UNIQUE INDEX "playground_sessions_share_token_uq"
  ON "playground_sessions" ("share_token")
  WHERE "share_token" IS NOT NULL;

CREATE INDEX "playground_sessions_tags_gin"
  ON "playground_sessions" USING GIN ("tags");

-- Aggregate leaderboard view over the last 90 days. Recomputed on every read;
-- if traffic grows we can materialize it without changing the API contract.
CREATE OR REPLACE VIEW "playground_model_leaderboard_90d" AS
WITH per_session AS (
  SELECT
    par.model_id,
    par.model_name,
    par.session_id,
    AVG(par.score)::numeric(6, 2) AS session_score,
    MAX(CASE
      WHEN par.score = sub.max_score THEN 1
      ELSE 0
    END) AS win_in_session
  FROM "playground_agent_runs" par
  JOIN (
    SELECT session_id, MAX(score) AS max_score
    FROM "playground_agent_runs"
    WHERE score IS NOT NULL
    GROUP BY session_id
  ) sub USING (session_id)
  WHERE par.score IS NOT NULL
    AND par.created_at >= now() - interval '90 days'
  GROUP BY par.model_id, par.model_name, par.session_id, sub.max_score
)
SELECT
  model_id,
  MAX(model_name) AS model_name,
  COUNT(*) AS sessions_played,
  ROUND(AVG(session_score), 1) AS avg_score,
  ROUND(100.0 * SUM(win_in_session) / NULLIF(COUNT(*), 0), 1) AS win_rate
FROM per_session
GROUP BY model_id
ORDER BY win_rate DESC NULLS LAST, avg_score DESC NULLS LAST;
