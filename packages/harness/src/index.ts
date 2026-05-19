import { z } from "zod";
import { BenchmarkCaseSchema, ScoringRubricSchema, TestSpecSchema } from "@pilab/benchmark-spec";
import {
  GitHubIssueImportSchema,
  IsoDateTimeSchema,
  JsonValueSchema,
  ModelSnapshotSchema,
  NonEmptyStringSchema,
  PullRequestCandidateSchema,
  RunEventSchema,
  RunStatusSchema,
} from "@pilab/shared";

export const HarnessWorkspaceSchema = z.object({
  rootDir: NonEmptyStringSchema,
  repoDir: NonEmptyStringSchema,
  scratchDir: NonEmptyStringSchema.optional(),
});
export type HarnessWorkspace = z.infer<typeof HarnessWorkspaceSchema>;

export const HarnessAdapterContextSchema = z.object({
  runId: NonEmptyStringSchema,
  case: BenchmarkCaseSchema,
  workspace: HarnessWorkspaceSchema,
  model: ModelSnapshotSchema.optional(),
  metadata: z.record(z.string(), JsonValueSchema).default({}),
});
export type HarnessAdapterContext = z.infer<typeof HarnessAdapterContextSchema>;

export const HarnessExecutionResultSchema = z.object({
  status: RunStatusSchema,
  startedAt: IsoDateTimeSchema,
  completedAt: IsoDateTimeSchema,
  durationMs: z.number().int().nonnegative(),
  events: z.array(RunEventSchema).default([]),
  artifacts: z.array(z.string().min(1)).default([]),
  output: z.string().optional(),
  error: z
    .object({
      message: NonEmptyStringSchema,
      stack: z.string().optional(),
      code: z.string().optional(),
    })
    .optional(),
});
export type HarnessExecutionResult = z.infer<typeof HarnessExecutionResultSchema>;

export const ScoreBreakdownSchema = z.object({
  criterionId: NonEmptyStringSchema,
  score: z.number(),
  maxScore: z.number().positive(),
  notes: z.string().optional(),
});
export type ScoreBreakdown = z.infer<typeof ScoreBreakdownSchema>;

export const ScoreResultSchema = z.object({
  rubric: ScoringRubricSchema,
  totalScore: z.number(),
  maxScore: z.number().positive(),
  passed: z.boolean(),
  breakdown: z.array(ScoreBreakdownSchema).default([]),
  notes: z.string().optional(),
});
export type ScoreResult = z.infer<typeof ScoreResultSchema>;

export const TestRunResultSchema = z.object({
  spec: TestSpecSchema,
  status: RunStatusSchema,
  commandResults: z.array(HarnessExecutionResultSchema).default([]),
});
export type TestRunResult = z.infer<typeof TestRunResultSchema>;

export const HarnessRunResultSchema = z.object({
  runId: NonEmptyStringSchema,
  caseId: NonEmptyStringSchema,
  candidate: PullRequestCandidateSchema.optional(),
  status: RunStatusSchema,
  tests: z.array(TestRunResultSchema).default([]),
  score: ScoreResultSchema.optional(),
  events: z.array(RunEventSchema).default([]),
  startedAt: IsoDateTimeSchema,
  completedAt: IsoDateTimeSchema.optional(),
});
export type HarnessRunResult = z.infer<typeof HarnessRunResultSchema>;

export interface HarnessAdapter {
  readonly id: string;
  prepare(context: HarnessAdapterContext): Promise<void>;
  applyCandidate(context: HarnessAdapterContext): Promise<void>;
  runTests(context: HarnessAdapterContext): Promise<TestRunResult[]>;
  score(context: HarnessAdapterContext, tests: TestRunResult[]): Promise<ScoreResult>;
  cleanup(context: HarnessAdapterContext): Promise<void>;
}

export interface IssueImportAdapter<TSource = unknown> {
  readonly id: string;
  importIssue(source: TSource): Promise<z.infer<typeof GitHubIssueImportSchema>>;
}

export interface RunEventSink {
  publish(event: z.infer<typeof RunEventSchema>): Promise<void>;
}
