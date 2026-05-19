CREATE TYPE "public"."artifact_kind" AS ENUM('github_issue', 'github_pull_request', 'gold_patch', 'test_patch', 'predicted_patch', 'plan', 'session_log', 'validation_log', 'evaluation_log', 'repository_metadata', 'raw_json', 'other');--> statement-breakpoint
CREATE TYPE "public"."case_status" AS ENUM('draft', 'building', 'ready', 'frozen', 'rejected', 'archived');--> statement-breakpoint
CREATE TYPE "public"."case_version_status" AS ENUM('candidate', 'validating', 'frozen', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."evaluation_status" AS ENUM('queued', 'running', 'passed', 'failed', 'error', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."experiment_mode" AS ENUM('plan_only', 'implementation_only', 'end_to_end');--> statement-breakpoint
CREATE TYPE "public"."patch_kind" AS ENUM('gold', 'test', 'predicted', 'manual');--> statement-breakpoint
CREATE TYPE "public"."run_event_kind" AS ENUM('status', 'assistant_text_delta', 'tool_call_started', 'tool_call_delta', 'tool_call_finished', 'file_changed', 'patch_created', 'test_started', 'test_finished', 'cost_update', 'error', 'score_update', 'artifact_created');--> statement-breakpoint
CREATE TYPE "public"."run_stage" AS ENUM('prepare', 'plan', 'judge', 'implement', 'evaluate', 'case_builder', 'validate', 'aggregate');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('queued', 'preparing', 'running', 'succeeded', 'failed', 'cancelled', 'timed_out');--> statement-breakpoint
CREATE TYPE "public"."test_spec_kind" AS ENUM('fail_to_pass', 'pass_to_pass');--> statement-breakpoint
CREATE TYPE "public"."test_spec_status" AS ENUM('proposed', 'accepted', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."validation_status" AS ENUM('queued', 'running', 'accepted', 'rejected', 'error', 'cancelled');--> statement-breakpoint
CREATE TABLE "agent_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"mode" "experiment_mode" NOT NULL,
	"planner_model_version_id" uuid,
	"implementer_model_version_id" uuid,
	"harness_version_id" uuid,
	"tool_policy" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"model_settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "artifact_kind" NOT NULL,
	"storage_provider" varchar(64) NOT NULL,
	"bucket" text,
	"object_key" text NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"byte_size" integer,
	"content_type" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "benchmark_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"benchmark_id" uuid,
	"github_issue_id" uuid,
	"slug" varchar(160) NOT NULL,
	"title" text NOT NULL,
	"status" "case_status" DEFAULT 'draft' NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"language_hints" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"difficulty" varchar(64),
	"leakage_warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"frozen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "benchmark_cases_to_benchmarks" (
	"benchmark_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	CONSTRAINT "benchmark_cases_to_benchmarks_benchmark_id_case_id_pk" PRIMARY KEY("benchmark_id","case_id")
);
--> statement-breakpoint
CREATE TABLE "benchmarks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid,
	"slug" varchar(128) NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"visibility" varchar(32) DEFAULT 'private' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "case_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" "case_version_status" DEFAULT 'candidate' NOT NULL,
	"github_issue_id" uuid,
	"github_pull_request_id" uuid,
	"issue_artifact_id" uuid,
	"pull_request_artifact_id" uuid,
	"repository_metadata_artifact_id" uuid,
	"gold_patch_artifact_id" uuid,
	"test_patch_artifact_id" uuid,
	"validation_log_artifact_id" uuid,
	"repo_owner" text NOT NULL,
	"repo_name" text NOT NULL,
	"base_commit_sha" varchar(64) NOT NULL,
	"gold_commit_sha" varchar(64),
	"environment_recipe" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"setup_commands" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"test_commands" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"prompt_versions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"test_builder_model_id" text,
	"validation_runner_version" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"frozen_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "evaluations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid,
	"patch_id" uuid,
	"case_version_id" uuid,
	"log_artifact_id" uuid,
	"evaluator_version" text NOT NULL,
	"status" "evaluation_status" DEFAULT 'queued' NOT NULL,
	"resolved" boolean DEFAULT false NOT NULL,
	"fail_to_pass_passed" integer DEFAULT 0 NOT NULL,
	"fail_to_pass_total" integer DEFAULT 0 NOT NULL,
	"pass_to_pass_passed" integer DEFAULT 0 NOT NULL,
	"pass_to_pass_total" integer DEFAULT 0 NOT NULL,
	"raw_results" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "experiments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"benchmark_id" uuid,
	"created_by_user_id" uuid,
	"name" text NOT NULL,
	"description" text,
	"mode" "experiment_mode" NOT NULL,
	"status" "run_status" DEFAULT 'queued' NOT NULL,
	"matrix" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "github_issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repo_owner" text NOT NULL,
	"repo_name" text NOT NULL,
	"issue_number" integer NOT NULL,
	"node_id" text,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"author_login" text,
	"state" varchar(32) NOT NULL,
	"labels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"comments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"timeline_events" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"opened_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "github_pull_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issue_id" uuid,
	"repo_owner" text NOT NULL,
	"repo_name" text NOT NULL,
	"pr_number" integer NOT NULL,
	"node_id" text,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"author_login" text,
	"state" varchar(32) NOT NULL,
	"base_ref" text,
	"base_sha" varchar(64) NOT NULL,
	"head_ref" text,
	"head_sha" varchar(64) NOT NULL,
	"merge_sha" varchar(64),
	"changed_files" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"opened_at" timestamp with time zone,
	"merged_at" timestamp with time zone,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gold_edit_atoms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_version_id" uuid NOT NULL,
	"source_patch_artifact_id" uuid,
	"atom_key" text,
	"file_path" text NOT NULL,
	"symbol" text,
	"behavior" text NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"weight" numeric(8, 4) NOT NULL,
	"human_edited" boolean DEFAULT false NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "harness_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"harness" varchar(64) NOT NULL,
	"version" text NOT NULL,
	"adapter_version" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "model_pricing_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"model_version_id" uuid,
	"gateway" varchar(64) DEFAULT 'openrouter' NOT NULL,
	"model_id" text NOT NULL,
	"prompt_price_per_million" numeric(18, 9),
	"completion_price_per_million" numeric(18, 9),
	"request_price" numeric(18, 9),
	"image_price" numeric(18, 9),
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "model_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gateway" varchar(64) DEFAULT 'openrouter' NOT NULL,
	"model_id" text NOT NULL,
	"name" text,
	"provider" text,
	"context_length" integer,
	"architecture" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "patches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid,
	"case_version_id" uuid,
	"artifact_id" uuid,
	"kind" "patch_kind" NOT NULL,
	"summary" text,
	"stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"case_version_id" uuid,
	"judge_model_version_id" uuid,
	"pricing_snapshot_id" uuid,
	"rubric_version" text NOT NULL,
	"prompt_version" text NOT NULL,
	"judge_run_ordinal" integer DEFAULT 1 NOT NULL,
	"overall_score" numeric(8, 4) NOT NULL,
	"dimensions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"atom_matches" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rationale" text,
	"is_public" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid,
	"case_version_id" uuid,
	"raw_artifact_id" uuid,
	"format_version" text NOT NULL,
	"plan_markdown" text,
	"plan_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"artifact_id" uuid,
	"seq" integer NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"stage" "run_stage" NOT NULL,
	"kind" "run_event_kind" NOT NULL,
	"payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"experiment_id" uuid NOT NULL,
	"case_version_id" uuid,
	"agent_config_id" uuid,
	"name" text,
	"status" "run_status" DEFAULT 'queued' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"experiment_id" uuid,
	"run_group_id" uuid,
	"case_version_id" uuid,
	"agent_config_id" uuid,
	"harness_version_id" uuid,
	"planner_model_version_id" uuid,
	"implementer_model_version_id" uuid,
	"pricing_snapshot_id" uuid,
	"mode" "experiment_mode" NOT NULL,
	"status" "run_status" DEFAULT 'queued' NOT NULL,
	"openrouter_model_id" text,
	"provider_routing_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"fallback_policy" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"resolved_upstream_provider" text,
	"request_id" text,
	"generation_id" text,
	"raw_usage" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"charged_cost" numeric(18, 9),
	"computed_cost" numeric(18, 9),
	"error" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "test_specs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_version_id" uuid NOT NULL,
	"validation_attempt_id" uuid,
	"name" text NOT NULL,
	"kind" "test_spec_kind" NOT NULL,
	"status" "test_spec_status" DEFAULT 'proposed' NOT NULL,
	"file_path" text,
	"test_command" text NOT NULL,
	"expected_failure_mode" text,
	"expected_pass_mode" text,
	"content" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text,
	"name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "validation_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_version_id" uuid NOT NULL,
	"candidate_tests_artifact_id" uuid,
	"base_log_artifact_id" uuid,
	"gold_log_artifact_id" uuid,
	"runner_version" text NOT NULL,
	"status" "validation_status" DEFAULT 'queued' NOT NULL,
	"accepted_test_count" integer DEFAULT 0 NOT NULL,
	"rejected_test_count" integer DEFAULT 0 NOT NULL,
	"raw_results" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "agent_configs" ADD CONSTRAINT "agent_configs_planner_model_version_id_model_versions_id_fk" FOREIGN KEY ("planner_model_version_id") REFERENCES "public"."model_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_configs" ADD CONSTRAINT "agent_configs_implementer_model_version_id_model_versions_id_fk" FOREIGN KEY ("implementer_model_version_id") REFERENCES "public"."model_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_configs" ADD CONSTRAINT "agent_configs_harness_version_id_harness_versions_id_fk" FOREIGN KEY ("harness_version_id") REFERENCES "public"."harness_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benchmark_cases" ADD CONSTRAINT "benchmark_cases_benchmark_id_benchmarks_id_fk" FOREIGN KEY ("benchmark_id") REFERENCES "public"."benchmarks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benchmark_cases" ADD CONSTRAINT "benchmark_cases_github_issue_id_github_issues_id_fk" FOREIGN KEY ("github_issue_id") REFERENCES "public"."github_issues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benchmark_cases_to_benchmarks" ADD CONSTRAINT "benchmark_cases_to_benchmarks_benchmark_id_benchmarks_id_fk" FOREIGN KEY ("benchmark_id") REFERENCES "public"."benchmarks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benchmark_cases_to_benchmarks" ADD CONSTRAINT "benchmark_cases_to_benchmarks_case_id_benchmark_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."benchmark_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benchmarks" ADD CONSTRAINT "benchmarks_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_versions" ADD CONSTRAINT "case_versions_case_id_benchmark_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."benchmark_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_versions" ADD CONSTRAINT "case_versions_github_issue_id_github_issues_id_fk" FOREIGN KEY ("github_issue_id") REFERENCES "public"."github_issues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_versions" ADD CONSTRAINT "case_versions_github_pull_request_id_github_pull_requests_id_fk" FOREIGN KEY ("github_pull_request_id") REFERENCES "public"."github_pull_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_versions" ADD CONSTRAINT "case_versions_issue_artifact_id_artifacts_id_fk" FOREIGN KEY ("issue_artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_versions" ADD CONSTRAINT "case_versions_pull_request_artifact_id_artifacts_id_fk" FOREIGN KEY ("pull_request_artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_versions" ADD CONSTRAINT "case_versions_repository_metadata_artifact_id_artifacts_id_fk" FOREIGN KEY ("repository_metadata_artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_versions" ADD CONSTRAINT "case_versions_gold_patch_artifact_id_artifacts_id_fk" FOREIGN KEY ("gold_patch_artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_versions" ADD CONSTRAINT "case_versions_test_patch_artifact_id_artifacts_id_fk" FOREIGN KEY ("test_patch_artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_versions" ADD CONSTRAINT "case_versions_validation_log_artifact_id_artifacts_id_fk" FOREIGN KEY ("validation_log_artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_patch_id_patches_id_fk" FOREIGN KEY ("patch_id") REFERENCES "public"."patches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_case_version_id_case_versions_id_fk" FOREIGN KEY ("case_version_id") REFERENCES "public"."case_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_log_artifact_id_artifacts_id_fk" FOREIGN KEY ("log_artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiments" ADD CONSTRAINT "experiments_benchmark_id_benchmarks_id_fk" FOREIGN KEY ("benchmark_id") REFERENCES "public"."benchmarks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiments" ADD CONSTRAINT "experiments_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_pull_requests" ADD CONSTRAINT "github_pull_requests_issue_id_github_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."github_issues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gold_edit_atoms" ADD CONSTRAINT "gold_edit_atoms_case_version_id_case_versions_id_fk" FOREIGN KEY ("case_version_id") REFERENCES "public"."case_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gold_edit_atoms" ADD CONSTRAINT "gold_edit_atoms_source_patch_artifact_id_artifacts_id_fk" FOREIGN KEY ("source_patch_artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_pricing_snapshots" ADD CONSTRAINT "model_pricing_snapshots_model_version_id_model_versions_id_fk" FOREIGN KEY ("model_version_id") REFERENCES "public"."model_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patches" ADD CONSTRAINT "patches_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patches" ADD CONSTRAINT "patches_case_version_id_case_versions_id_fk" FOREIGN KEY ("case_version_id") REFERENCES "public"."case_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patches" ADD CONSTRAINT "patches_artifact_id_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_scores" ADD CONSTRAINT "plan_scores_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_scores" ADD CONSTRAINT "plan_scores_case_version_id_case_versions_id_fk" FOREIGN KEY ("case_version_id") REFERENCES "public"."case_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_scores" ADD CONSTRAINT "plan_scores_judge_model_version_id_model_versions_id_fk" FOREIGN KEY ("judge_model_version_id") REFERENCES "public"."model_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_scores" ADD CONSTRAINT "plan_scores_pricing_snapshot_id_model_pricing_snapshots_id_fk" FOREIGN KEY ("pricing_snapshot_id") REFERENCES "public"."model_pricing_snapshots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_case_version_id_case_versions_id_fk" FOREIGN KEY ("case_version_id") REFERENCES "public"."case_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_raw_artifact_id_artifacts_id_fk" FOREIGN KEY ("raw_artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_events" ADD CONSTRAINT "run_events_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_events" ADD CONSTRAINT "run_events_artifact_id_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_groups" ADD CONSTRAINT "run_groups_experiment_id_experiments_id_fk" FOREIGN KEY ("experiment_id") REFERENCES "public"."experiments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_groups" ADD CONSTRAINT "run_groups_case_version_id_case_versions_id_fk" FOREIGN KEY ("case_version_id") REFERENCES "public"."case_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_groups" ADD CONSTRAINT "run_groups_agent_config_id_agent_configs_id_fk" FOREIGN KEY ("agent_config_id") REFERENCES "public"."agent_configs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_experiment_id_experiments_id_fk" FOREIGN KEY ("experiment_id") REFERENCES "public"."experiments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_run_group_id_run_groups_id_fk" FOREIGN KEY ("run_group_id") REFERENCES "public"."run_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_case_version_id_case_versions_id_fk" FOREIGN KEY ("case_version_id") REFERENCES "public"."case_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_agent_config_id_agent_configs_id_fk" FOREIGN KEY ("agent_config_id") REFERENCES "public"."agent_configs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_harness_version_id_harness_versions_id_fk" FOREIGN KEY ("harness_version_id") REFERENCES "public"."harness_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_planner_model_version_id_model_versions_id_fk" FOREIGN KEY ("planner_model_version_id") REFERENCES "public"."model_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_implementer_model_version_id_model_versions_id_fk" FOREIGN KEY ("implementer_model_version_id") REFERENCES "public"."model_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_pricing_snapshot_id_model_pricing_snapshots_id_fk" FOREIGN KEY ("pricing_snapshot_id") REFERENCES "public"."model_pricing_snapshots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_specs" ADD CONSTRAINT "test_specs_case_version_id_case_versions_id_fk" FOREIGN KEY ("case_version_id") REFERENCES "public"."case_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_specs" ADD CONSTRAINT "test_specs_validation_attempt_id_validation_attempts_id_fk" FOREIGN KEY ("validation_attempt_id") REFERENCES "public"."validation_attempts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "validation_attempts" ADD CONSTRAINT "validation_attempts_case_version_id_case_versions_id_fk" FOREIGN KEY ("case_version_id") REFERENCES "public"."case_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "validation_attempts" ADD CONSTRAINT "validation_attempts_candidate_tests_artifact_id_artifacts_id_fk" FOREIGN KEY ("candidate_tests_artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "validation_attempts" ADD CONSTRAINT "validation_attempts_base_log_artifact_id_artifacts_id_fk" FOREIGN KEY ("base_log_artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "validation_attempts" ADD CONSTRAINT "validation_attempts_gold_log_artifact_id_artifacts_id_fk" FOREIGN KEY ("gold_log_artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_configs_mode_idx" ON "agent_configs" USING btree ("mode");--> statement-breakpoint
CREATE INDEX "agent_configs_harness_version_id_idx" ON "agent_configs" USING btree ("harness_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "artifacts_storage_object_idx" ON "artifacts" USING btree ("storage_provider","bucket","object_key");--> statement-breakpoint
CREATE INDEX "artifacts_sha256_idx" ON "artifacts" USING btree ("sha256");--> statement-breakpoint
CREATE INDEX "artifacts_kind_idx" ON "artifacts" USING btree ("kind");--> statement-breakpoint
CREATE UNIQUE INDEX "benchmark_cases_slug_idx" ON "benchmark_cases" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "benchmark_cases_benchmark_id_idx" ON "benchmark_cases" USING btree ("benchmark_id");--> statement-breakpoint
CREATE INDEX "benchmark_cases_github_issue_id_idx" ON "benchmark_cases" USING btree ("github_issue_id");--> statement-breakpoint
CREATE INDEX "benchmark_cases_status_idx" ON "benchmark_cases" USING btree ("status");--> statement-breakpoint
CREATE INDEX "benchmark_cases_to_benchmarks_case_id_idx" ON "benchmark_cases_to_benchmarks" USING btree ("case_id");--> statement-breakpoint
CREATE UNIQUE INDEX "benchmarks_slug_idx" ON "benchmarks" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "benchmarks_owner_user_id_idx" ON "benchmarks" USING btree ("owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "case_versions_case_id_version_idx" ON "case_versions" USING btree ("case_id","version");--> statement-breakpoint
CREATE INDEX "case_versions_case_id_idx" ON "case_versions" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "case_versions_status_idx" ON "case_versions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "case_versions_github_pr_id_idx" ON "case_versions" USING btree ("github_pull_request_id");--> statement-breakpoint
CREATE INDEX "evaluations_run_id_idx" ON "evaluations" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "evaluations_patch_id_idx" ON "evaluations" USING btree ("patch_id");--> statement-breakpoint
CREATE INDEX "evaluations_case_version_id_idx" ON "evaluations" USING btree ("case_version_id");--> statement-breakpoint
CREATE INDEX "evaluations_status_idx" ON "evaluations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "experiments_benchmark_id_idx" ON "experiments" USING btree ("benchmark_id");--> statement-breakpoint
CREATE INDEX "experiments_status_idx" ON "experiments" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "github_issues_url_idx" ON "github_issues" USING btree ("url");--> statement-breakpoint
CREATE UNIQUE INDEX "github_issues_repo_number_idx" ON "github_issues" USING btree ("repo_owner","repo_name","issue_number");--> statement-breakpoint
CREATE UNIQUE INDEX "github_pull_requests_url_idx" ON "github_pull_requests" USING btree ("url");--> statement-breakpoint
CREATE UNIQUE INDEX "github_pull_requests_repo_number_idx" ON "github_pull_requests" USING btree ("repo_owner","repo_name","pr_number");--> statement-breakpoint
CREATE INDEX "github_pull_requests_issue_id_idx" ON "github_pull_requests" USING btree ("issue_id");--> statement-breakpoint
CREATE INDEX "gold_edit_atoms_case_version_id_idx" ON "gold_edit_atoms" USING btree ("case_version_id");--> statement-breakpoint
CREATE INDEX "gold_edit_atoms_file_path_idx" ON "gold_edit_atoms" USING btree ("file_path");--> statement-breakpoint
CREATE UNIQUE INDEX "harness_versions_harness_version_idx" ON "harness_versions" USING btree ("harness","version");--> statement-breakpoint
CREATE INDEX "model_pricing_snapshots_model_id_idx" ON "model_pricing_snapshots" USING btree ("model_id");--> statement-breakpoint
CREATE INDEX "model_pricing_snapshots_captured_at_idx" ON "model_pricing_snapshots" USING btree ("captured_at");--> statement-breakpoint
CREATE UNIQUE INDEX "model_versions_gateway_model_synced_idx" ON "model_versions" USING btree ("gateway","model_id","synced_at");--> statement-breakpoint
CREATE INDEX "model_versions_model_id_idx" ON "model_versions" USING btree ("model_id");--> statement-breakpoint
CREATE INDEX "patches_run_id_idx" ON "patches" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "patches_case_version_id_idx" ON "patches" USING btree ("case_version_id");--> statement-breakpoint
CREATE INDEX "patches_kind_idx" ON "patches" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "plan_scores_plan_id_idx" ON "plan_scores" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "plan_scores_case_version_id_idx" ON "plan_scores" USING btree ("case_version_id");--> statement-breakpoint
CREATE INDEX "plan_scores_public_idx" ON "plan_scores" USING btree ("is_public");--> statement-breakpoint
CREATE INDEX "plans_run_id_idx" ON "plans" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "plans_case_version_id_idx" ON "plans" USING btree ("case_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "run_events_run_id_seq_idx" ON "run_events" USING btree ("run_id","seq");--> statement-breakpoint
CREATE INDEX "run_events_run_id_ts_idx" ON "run_events" USING btree ("run_id","ts");--> statement-breakpoint
CREATE INDEX "run_events_kind_idx" ON "run_events" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "run_groups_experiment_id_idx" ON "run_groups" USING btree ("experiment_id");--> statement-breakpoint
CREATE INDEX "run_groups_case_version_id_idx" ON "run_groups" USING btree ("case_version_id");--> statement-breakpoint
CREATE INDEX "run_groups_status_idx" ON "run_groups" USING btree ("status");--> statement-breakpoint
CREATE INDEX "runs_experiment_id_idx" ON "runs" USING btree ("experiment_id");--> statement-breakpoint
CREATE INDEX "runs_run_group_id_idx" ON "runs" USING btree ("run_group_id");--> statement-breakpoint
CREATE INDEX "runs_case_version_id_idx" ON "runs" USING btree ("case_version_id");--> statement-breakpoint
CREATE INDEX "runs_status_idx" ON "runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "runs_openrouter_model_id_idx" ON "runs" USING btree ("openrouter_model_id");--> statement-breakpoint
CREATE INDEX "test_specs_case_version_id_idx" ON "test_specs" USING btree ("case_version_id");--> statement-breakpoint
CREATE INDEX "test_specs_validation_attempt_id_idx" ON "test_specs" USING btree ("validation_attempt_id");--> statement-breakpoint
CREATE INDEX "test_specs_kind_status_idx" ON "test_specs" USING btree ("kind","status");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "validation_attempts_case_version_id_idx" ON "validation_attempts" USING btree ("case_version_id");--> statement-breakpoint
CREATE INDEX "validation_attempts_status_idx" ON "validation_attempts" USING btree ("status");