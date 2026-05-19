CREATE TYPE "public"."dataset_status" AS ENUM('draft', 'active', 'archived');--> statement-breakpoint
CREATE TABLE "dataset_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dataset_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "datasets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(160) NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" "dataset_status" DEFAULT 'draft' NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dataset_cases" ADD CONSTRAINT "dataset_cases_dataset_id_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."datasets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dataset_cases" ADD CONSTRAINT "dataset_cases_case_id_benchmark_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."benchmark_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dataset_cases_unique_idx" ON "dataset_cases" USING btree ("dataset_id","case_id");--> statement-breakpoint
CREATE INDEX "dataset_cases_case_id_idx" ON "dataset_cases" USING btree ("case_id");--> statement-breakpoint
CREATE UNIQUE INDEX "datasets_slug_idx" ON "datasets" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "datasets_status_idx" ON "datasets" USING btree ("status");