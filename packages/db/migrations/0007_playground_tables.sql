CREATE TYPE "public"."playground_session_status" AS ENUM('pending', 'running', 'completed', 'failed');
CREATE TYPE "public"."playground_agent_run_status" AS ENUM('queued', 'preparing', 'running', 'succeeded', 'failed');
CREATE TYPE "public"."playground_event_kind" AS ENUM('status', 'assistant_text_delta', 'tool_call_started', 'tool_call_delta', 'tool_call_finished', 'port_open', 'url_resolved', 'error');

CREATE TABLE "playground_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prompt" text NOT NULL,
	"status" "playground_session_status" DEFAULT 'pending' NOT NULL,
	"grading_mode" text,
	"grader_model_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);

CREATE TABLE "playground_agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL REFERENCES "playground_sessions"("id") ON DELETE cascade,
	"model_id" text NOT NULL,
	"model_name" text NOT NULL,
	"status" "playground_agent_run_status" DEFAULT 'queued' NOT NULL,
	"sandbox_id" text,
	"app_url" text,
	"output" text,
	"score" integer,
	"score_rationale" text,
	"scored_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);

CREATE TABLE "playground_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_run_id" uuid NOT NULL REFERENCES "playground_agent_runs"("id") ON DELETE cascade,
	"seq" integer NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" "playground_event_kind" NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL
);
