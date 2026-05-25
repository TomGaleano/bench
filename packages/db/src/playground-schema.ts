import { sql } from "drizzle-orm";
import {
  boolean,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

const emptyObject = sql`'{}'::jsonb`;

export const playgroundSessionStatus = pgEnum("playground_session_status", [
  "pending",
  "running",
  "completed",
  "failed",
]);

export const playgroundAgentRunStatus = pgEnum("playground_agent_run_status", [
  "queued",
  "preparing",
  "running",
  "succeeded",
  "failed",
]);

export const playgroundEventKind = pgEnum("playground_event_kind", [
  "status",
  "assistant_text_delta",
  "tool_call_started",
  "tool_call_delta",
  "tool_call_finished",
  "port_open",
  "url_resolved",
  "error",
  "user_follow_up",
  "turn_complete",
]);

export const playgroundSessions = pgTable("playground_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  prompt: text("prompt").notNull(),
  status: playgroundSessionStatus("status").notNull().default("pending"),
  gradingMode: text("grading_mode"),
  graderModelId: text("grader_model_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  saved: boolean("saved").notNull().default(false),
  maxWallClockSeconds: integer("max_wall_clock_seconds"),
  maxOutputTokensPerAgent: integer("max_output_tokens_per_agent"),
  tools: text("tools").array(),
  sandboxImage: text("sandbox_image"),
  seedPromptText: text("seed_prompt_text"),
  runTwiceAndAverage: boolean("run_twice_and_average").notNull().default(false),
  title: text("title"),
  tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
  shareToken: text("share_token"),
});

export const playgroundAgentRuns = pgTable("playground_agent_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  sessionId: uuid("session_id")
    .notNull()
    .references(() => playgroundSessions.id, { onDelete: "cascade" }),
  modelId: text("model_id").notNull(),
  modelName: text("model_name").notNull(),
  status: playgroundAgentRunStatus("status").notNull().default("queued"),
  sandboxId: text("sandbox_id"),
  appUrl: text("app_url"),
  output: text("output"),
  score: integer("score"),
  scoreRationale: text("score_rationale"),
  scoreCorrectness: smallint("score_correctness"),
  scoreCodeQuality: smallint("score_code_quality"),
  scoreUx: smallint("score_ux"),
  scoreShipIt: smallint("score_ship_it"),
  scoredAt: timestamp("scored_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  parentAgentRunId: uuid("parent_agent_run_id"),
  cancellationReason: text("cancellation_reason"),
  fileCount: integer("file_count"),
  loc: integer("loc"),
});

export const playgroundAutograderRuns = pgTable("playground_autograder_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  sessionId: uuid("session_id")
    .notNull()
    .references(() => playgroundSessions.id, { onDelete: "cascade" }),
  graderModelId: text("grader_model_id").notNull(),
  status: text("status").notNull().default("pending"),
  latencyMs: integer("latency_ms"),
  usdCost: numeric("usd_cost", { precision: 10, scale: 4 }),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

export const playgroundAutograderScores = pgTable("playground_autograder_scores", {
  id: uuid("id").defaultRandom().primaryKey(),
  autograderRunId: uuid("autograder_run_id")
    .notNull()
    .references(() => playgroundAutograderRuns.id, { onDelete: "cascade" }),
  agentRunId: uuid("agent_run_id")
    .notNull()
    .references(() => playgroundAgentRuns.id, { onDelete: "cascade" }),
  overall: integer("overall"),
  correctness: smallint("correctness"),
  codeQuality: smallint("code_quality"),
  ux: smallint("ux"),
  shipIt: smallint("ship_it"),
  rationale: text("rationale"),
});

export const playgroundEvents = pgTable("playground_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  agentRunId: uuid("agent_run_id")
    .notNull()
    .references(() => playgroundAgentRuns.id, { onDelete: "cascade" }),
  seq: integer("seq").notNull(),
  ts: timestamp("ts", { withTimezone: true }).defaultNow().notNull(),
  kind: playgroundEventKind("kind").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().default(emptyObject).notNull(),
});

export type PlaygroundSession = typeof playgroundSessions.$inferSelect;
export type NewPlaygroundSession = typeof playgroundSessions.$inferInsert;
export type PlaygroundAgentRun = typeof playgroundAgentRuns.$inferSelect;
export type NewPlaygroundAgentRun = typeof playgroundAgentRuns.$inferInsert;
export type PlaygroundEvent = Omit<typeof playgroundEvents.$inferSelect, "ts"> & { timestamp: Date };
export type NewPlaygroundEvent = typeof playgroundEvents.$inferInsert;
export type PlaygroundAutograderRun = typeof playgroundAutograderRuns.$inferSelect;
export type NewPlaygroundAutograderRun = typeof playgroundAutograderRuns.$inferInsert;
export type PlaygroundAutograderScore = typeof playgroundAutograderScores.$inferSelect;
export type NewPlaygroundAutograderScore = typeof playgroundAutograderScores.$inferInsert;
