import { z } from "zod";
import {
  GitHubIssueImportSchema,
  IsoDateTimeSchema,
  JsonValueSchema,
  NonEmptyStringSchema,
  PullRequestCandidateSchema,
} from "@pilab/shared";

export const TestCommandSchema = z.object({
  id: NonEmptyStringSchema,
  command: NonEmptyStringSchema,
  cwd: z.string().optional(),
  timeoutMs: z.number().int().positive().optional(),
  env: z.record(z.string(), z.string()).default({}),
});
export type TestCommand = z.infer<typeof TestCommandSchema>;

export const TestSpecSchema = z.object({
  id: NonEmptyStringSchema,
  name: NonEmptyStringSchema,
  description: z.string().optional(),
  setup: z.array(TestCommandSchema).default([]),
  verify: z.array(TestCommandSchema).min(1),
  artifacts: z.array(z.string().min(1)).default([]),
  expectedSignals: z.array(NonEmptyStringSchema).default([]),
});
export type TestSpec = z.infer<typeof TestSpecSchema>;

export const ScoringCriterionSchema = z.object({
  id: NonEmptyStringSchema,
  name: NonEmptyStringSchema,
  description: z.string(),
  weight: z.number().positive(),
  scale: z.object({
    min: z.number(),
    max: z.number(),
  }),
});
export type ScoringCriterion = z.infer<typeof ScoringCriterionSchema>;

export const ScoringRubricSchema = z.object({
  id: NonEmptyStringSchema,
  name: NonEmptyStringSchema,
  version: NonEmptyStringSchema,
  criteria: z.array(ScoringCriterionSchema).min(1),
  passingScore: z.number().min(0).optional(),
});
export type ScoringRubric = z.infer<typeof ScoringRubricSchema>;

export const BenchmarkCaseSchema = z.object({
  id: NonEmptyStringSchema,
  suiteId: NonEmptyStringSchema,
  title: NonEmptyStringSchema,
  description: z.string(),
  difficulty: z.enum(["smoke", "easy", "medium", "hard", "expert"]),
  issue: GitHubIssueImportSchema.optional(),
  candidates: z.array(PullRequestCandidateSchema).default([]),
  tests: z.array(TestSpecSchema).min(1),
  rubric: ScoringRubricSchema,
  tags: z.array(NonEmptyStringSchema).default([]),
  metadata: z.record(z.string(), JsonValueSchema).default({}),
});
export type BenchmarkCase = z.infer<typeof BenchmarkCaseSchema>;

export const BenchmarkSuiteSchema = z.object({
  id: NonEmptyStringSchema,
  name: NonEmptyStringSchema,
  version: NonEmptyStringSchema,
  description: z.string().optional(),
  cases: z.array(BenchmarkCaseSchema).default([]),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema.optional(),
});
export type BenchmarkSuite = z.infer<typeof BenchmarkSuiteSchema>;
