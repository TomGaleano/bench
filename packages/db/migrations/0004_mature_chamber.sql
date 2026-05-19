CREATE TYPE "public"."reproduction_step_status" AS ENUM('proposed', 'validating', 'accepted', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."validation_strategy" AS ENUM('unit_tests', 'reproduction_steps');--> statement-breakpoint
CREATE TABLE "reproduction_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_version_id" uuid NOT NULL,
	"validation_attempt_id" uuid,
	"steps" jsonb NOT NULL,
	"script" text NOT NULL,
	"rationale" text,
	"status" "reproduction_step_status" DEFAULT 'proposed' NOT NULL,
	"reproduced_on_base" boolean,
	"fixed_on_gold" boolean,
	"raw_results" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "validation_attempts" ADD COLUMN "attempt_number" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "validation_attempts" ADD COLUMN "strategy" "validation_strategy" DEFAULT 'unit_tests' NOT NULL;--> statement-breakpoint
ALTER TABLE "validation_attempts" ADD COLUMN "previous_attempt_id" uuid;--> statement-breakpoint
ALTER TABLE "reproduction_steps" ADD CONSTRAINT "reproduction_steps_case_version_id_case_versions_id_fk" FOREIGN KEY ("case_version_id") REFERENCES "public"."case_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reproduction_steps" ADD CONSTRAINT "reproduction_steps_validation_attempt_id_validation_attempts_id_fk" FOREIGN KEY ("validation_attempt_id") REFERENCES "public"."validation_attempts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reproduction_steps_case_version_id_idx" ON "reproduction_steps" USING btree ("case_version_id");--> statement-breakpoint
CREATE INDEX "reproduction_steps_validation_attempt_id_idx" ON "reproduction_steps" USING btree ("validation_attempt_id");--> statement-breakpoint
CREATE INDEX "reproduction_steps_status_idx" ON "reproduction_steps" USING btree ("status");--> statement-breakpoint
ALTER TABLE "validation_attempts" ADD CONSTRAINT "validation_attempts_previous_attempt_id_validation_attempts_id_fk" FOREIGN KEY ("previous_attempt_id") REFERENCES "public"."validation_attempts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "validation_attempts_strategy_idx" ON "validation_attempts" USING btree ("strategy");