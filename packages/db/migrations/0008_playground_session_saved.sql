ALTER TABLE "playground_sessions" ADD COLUMN "saved" boolean DEFAULT false NOT NULL;
CREATE INDEX "playground_sessions_saved_idx" ON "playground_sessions" ("saved") WHERE "saved" = true;
