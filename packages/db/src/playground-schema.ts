import { sql } from "drizzle-orm";
import {
  boolean,
  integer,
  jsonb,
  pgEnum,
  pgTable,
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
  scoredAt: timestamp("scored_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
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
