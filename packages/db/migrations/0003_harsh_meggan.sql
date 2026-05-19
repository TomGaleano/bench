CREATE TYPE "public"."run_current_stage" AS ENUM('planning', 'implementation', 'grading');--> statement-breakpoint
CREATE TABLE "experiment_agent_configs" (
	"experiment_id" uuid NOT NULL,
	"agent_config_id" uuid NOT NULL,
	CONSTRAINT "experiment_agent_configs_experiment_id_agent_config_id_pk" PRIMARY KEY("experiment_id","agent_config_id")
);
--> statement-breakpoint
CREATE TABLE "experiment_case_versions" (
	"experiment_id" uuid NOT NULL,
	"case_version_id" uuid NOT NULL,
	CONSTRAINT "experiment_case_versions_experiment_id_case_version_id_pk" PRIMARY KEY("experiment_id","case_version_id")
);
--> statement-breakpoint
CREATE TABLE "grader_verdicts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"experiment_id" uuid,
	"run_a_id" uuid NOT NULL,
	"run_b_id" uuid NOT NULL,
	"winner_run_id" uuid,
	"reasoning" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "evaluations" ADD COLUMN "diff_similarity_score" numeric(8, 4);--> statement-breakpoint
ALTER TABLE "experiments" ADD COLUMN "dataset_id" uuid;--> statement-breakpoint
ALTER TABLE "plan_scores" ADD COLUMN "correctness_score" integer;--> statement-breakpoint
ALTER TABLE "plan_scores" ADD COLUMN "completeness_score" integer;--> statement-breakpoint
ALTER TABLE "plan_scores" ADD COLUMN "safety_score" integer;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "stage" "run_current_stage";--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "parent_run_id" uuid;--> statement-breakpoint
ALTER TABLE "experiment_agent_configs" ADD CONSTRAINT "experiment_agent_configs_experiment_id_experiments_id_fk" FOREIGN KEY ("experiment_id") REFERENCES "public"."experiments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiment_agent_configs" ADD CONSTRAINT "experiment_agent_configs_agent_config_id_agent_configs_id_fk" FOREIGN KEY ("agent_config_id") REFERENCES "public"."agent_configs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiment_case_versions" ADD CONSTRAINT "experiment_case_versions_experiment_id_experiments_id_fk" FOREIGN KEY ("experiment_id") REFERENCES "public"."experiments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiment_case_versions" ADD CONSTRAINT "experiment_case_versions_case_version_id_case_versions_id_fk" FOREIGN KEY ("case_version_id") REFERENCES "public"."case_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grader_verdicts" ADD CONSTRAINT "grader_verdicts_experiment_id_experiments_id_fk" FOREIGN KEY ("experiment_id") REFERENCES "public"."experiments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grader_verdicts" ADD CONSTRAINT "grader_verdicts_run_a_id_runs_id_fk" FOREIGN KEY ("run_a_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grader_verdicts" ADD CONSTRAINT "grader_verdicts_run_b_id_runs_id_fk" FOREIGN KEY ("run_b_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grader_verdicts" ADD CONSTRAINT "grader_verdicts_winner_run_id_runs_id_fk" FOREIGN KEY ("winner_run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "grader_verdicts_experiment_id_idx" ON "grader_verdicts" USING btree ("experiment_id");--> statement-breakpoint
CREATE INDEX "grader_verdicts_run_a_id_idx" ON "grader_verdicts" USING btree ("run_a_id");--> statement-breakpoint
CREATE INDEX "grader_verdicts_run_b_id_idx" ON "grader_verdicts" USING btree ("run_b_id");--> statement-breakpoint
ALTER TABLE "experiments" ADD CONSTRAINT "experiments_dataset_id_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."datasets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_parent_run_id_runs_id_fk" FOREIGN KEY ("parent_run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;