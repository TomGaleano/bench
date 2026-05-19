import { z } from "zod";

export const IsoDateTimeSchema = z.string().datetime({ offset: true });
export const UrlSchema = z.string().url();
export const NonEmptyStringSchema = z.string().trim().min(1);
export const ShaSchema = z.string().regex(/^[a-f0-9]{40}$/i, "Expected a 40-character git SHA");

export const JsonPrimitiveSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export type JsonPrimitive = z.infer<typeof JsonPrimitiveSchema>;

export type JsonValue =
  | JsonPrimitive
  | { [key: string]: JsonValue }
  | JsonValue[];

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([JsonPrimitiveSchema, z.array(JsonValueSchema), z.record(z.string(), JsonValueSchema)]),
);

export const GitHubUserSchema = z.object({
  id: z.number().int().nonnegative(),
  login: NonEmptyStringSchema,
  type: z.enum(["Bot", "Organization", "User"]).catch("User"),
  url: UrlSchema.optional(),
  avatarUrl: UrlSchema.optional(),
});
export type GitHubUser = z.infer<typeof GitHubUserSchema>;

export const GitHubLabelSchema = z.object({
  id: z.number().int().nonnegative().optional(),
  name: NonEmptyStringSchema,
  color: z.string().regex(/^[a-f0-9]{6}$/i).optional(),
  description: z.string().nullable().optional(),
});
export type GitHubLabel = z.infer<typeof GitHubLabelSchema>;

export const GitHubMilestoneSchema = z.object({
  id: z.number().int().nonnegative(),
  number: z.number().int().positive(),
  title: NonEmptyStringSchema,
  state: z.enum(["open", "closed"]),
  dueOn: IsoDateTimeSchema.nullable().optional(),
});
export type GitHubMilestone = z.infer<typeof GitHubMilestoneSchema>;

export const GitHubIssueCommentSchema = z.object({
  id: z.number().int().nonnegative(),
  author: GitHubUserSchema.nullable(),
  body: z.string(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema.optional(),
});
export type GitHubIssueComment = z.infer<typeof GitHubIssueCommentSchema>;

export const GitHubIssueImportSchema = z.object({
  provider: z.literal("github"),
  repository: z.object({
    owner: NonEmptyStringSchema,
    name: NonEmptyStringSchema,
    url: UrlSchema.optional(),
    defaultBranch: NonEmptyStringSchema.optional(),
  }),
  id: z.number().int().nonnegative(),
  number: z.number().int().positive(),
  title: NonEmptyStringSchema,
  body: z.string().nullable(),
  state: z.enum(["open", "closed"]),
  author: GitHubUserSchema.nullable(),
  assignees: z.array(GitHubUserSchema).default([]),
  labels: z.array(GitHubLabelSchema).default([]),
  milestone: GitHubMilestoneSchema.nullable().optional(),
  comments: z.array(GitHubIssueCommentSchema).default([]),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  closedAt: IsoDateTimeSchema.nullable().optional(),
  importedAt: IsoDateTimeSchema,
  sourceUrl: UrlSchema,
});
export type GitHubIssueImport = z.infer<typeof GitHubIssueImportSchema>;

export const GitRefSchema = z.object({
  repository: z.object({
    owner: NonEmptyStringSchema,
    name: NonEmptyStringSchema,
    url: UrlSchema.optional(),
  }),
  branch: NonEmptyStringSchema,
  sha: ShaSchema.optional(),
});
export type GitRef = z.infer<typeof GitRefSchema>;

export const PullRequestCandidateSchema = z.object({
  id: NonEmptyStringSchema,
  issueNumber: z.number().int().positive().optional(),
  title: NonEmptyStringSchema,
  summary: z.string().optional(),
  base: GitRefSchema,
  head: GitRefSchema,
  draft: z.boolean().default(true),
  labels: z.array(GitHubLabelSchema).default([]),
  changedFiles: z.array(z.string().min(1)).default([]),
  generatedBy: z.object({
    agent: NonEmptyStringSchema,
    model: NonEmptyStringSchema.optional(),
    runId: NonEmptyStringSchema.optional(),
  }),
  createdAt: IsoDateTimeSchema,
  metadata: z.record(z.string(), JsonValueSchema).default({}),
});
export type PullRequestCandidate = z.infer<typeof PullRequestCandidateSchema>;

export const ModelSnapshotSchema = z.object({
  id: NonEmptyStringSchema,
  provider: NonEmptyStringSchema,
  model: NonEmptyStringSchema,
  version: z.string().optional(),
  capturedAt: IsoDateTimeSchema,
  parameters: z
    .object({
      temperature: z.number().min(0).optional(),
      topP: z.number().min(0).max(1).optional(),
      maxOutputTokens: z.number().int().positive().optional(),
    })
    .default({}),
  metadata: z.record(z.string(), JsonValueSchema).default({}),
});
export type ModelSnapshot = z.infer<typeof ModelSnapshotSchema>;

export const RunStatusSchema = z.enum(["queued", "running", "passed", "failed", "errored", "cancelled"]);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const RunEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("run.started"),
    runId: NonEmptyStringSchema,
    caseId: NonEmptyStringSchema.optional(),
    timestamp: IsoDateTimeSchema,
    model: ModelSnapshotSchema.optional(),
  }),
  z.object({
    type: z.literal("run.log"),
    runId: NonEmptyStringSchema,
    timestamp: IsoDateTimeSchema,
    level: z.enum(["debug", "info", "warn", "error"]),
    message: z.string(),
    data: JsonValueSchema.optional(),
  }),
  z.object({
    type: z.literal("run.metric"),
    runId: NonEmptyStringSchema,
    timestamp: IsoDateTimeSchema,
    name: NonEmptyStringSchema,
    value: z.number(),
    unit: z.string().optional(),
  }),
  z.object({
    type: z.literal("run.completed"),
    runId: NonEmptyStringSchema,
    timestamp: IsoDateTimeSchema,
    status: RunStatusSchema,
    durationMs: z.number().int().nonnegative(),
    error: z
      .object({
        message: NonEmptyStringSchema,
        stack: z.string().optional(),
        code: z.string().optional(),
      })
      .optional(),
  }),
]);
export type RunEvent = z.infer<typeof RunEventSchema>;
