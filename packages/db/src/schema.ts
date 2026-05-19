import { relations, sql } from "drizzle-orm";
import {
  boolean,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
  index,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

type JsonRecord = Record<string, unknown>;

const emptyObject = sql`'{}'::jsonb`;
const emptyArray = sql`'[]'::jsonb`;

export const caseStatus = pgEnum("case_status", [
  "draft",
  "building",
  "ready",
  "frozen",
  "rejected",
  "archived",
]);

export const caseVersionStatus = pgEnum("case_version_status", [
  "candidate",
  "validating",
  "frozen",
  "rejected",
]);

export const experimentMode = pgEnum("experiment_mode", [
  "plan_only",
  "implementation_only",
  "end_to_end",
]);

export const runCurrentStage = pgEnum("run_current_stage", [
  "planning",
  "implementation",
  "grading",
]);

export const runStatus = pgEnum("run_status", [
  "queued",
  "preparing",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "timed_out",
]);

export const runStage = pgEnum("run_stage", [
  "prepare",
  "plan",
  "judge",
  "implement",
  "evaluate",
  "case_builder",
  "validate",
  "aggregate",
]);

export const runEventKind = pgEnum("run_event_kind", [
  "status",
  "assistant_text_delta",
  "tool_call_started",
  "tool_call_delta",
  "tool_call_finished",
  "file_changed",
  "patch_created",
  "test_started",
  "test_finished",
  "cost_update",
  "error",
  "score_update",
  "artifact_created",
]);

export const artifactKind = pgEnum("artifact_kind", [
  "github_issue",
  "github_pull_request",
  "gold_patch",
  "test_patch",
  "predicted_patch",
  "plan",
  "session_log",
  "validation_log",
  "evaluation_log",
  "repository_metadata",
  "raw_json",
  "other",
]);

export const patchKind = pgEnum("patch_kind", [
  "gold",
  "test",
  "predicted",
  "manual",
]);

export const testSpecKind = pgEnum("test_spec_kind", [
  "fail_to_pass",
  "pass_to_pass",
]);

export const testSpecStatus = pgEnum("test_spec_status", [
  "proposed",
  "accepted",
  "rejected",
]);

export const evaluationStatus = pgEnum("evaluation_status", [
  "queued",
  "running",
  "passed",
  "failed",
  "error",
  "cancelled",
]);

export const validationStatus = pgEnum("validation_status", [
  "queued",
  "running",
  "accepted",
  "rejected",
  "error",
  "cancelled",
]);

export const validationStrategy = pgEnum("validation_strategy", [
  "unit_tests",
  "reproduction_steps",
]);

export const reproductionStepStatus = pgEnum("reproduction_step_status", [
  "proposed",
  "validating",
  "accepted",
  "rejected",
]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: text("email"),
    name: text("name"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [uniqueIndex("users_email_idx").on(table.email)],
);

export const benchmarks = pgTable(
  "benchmarks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerUserId: uuid("owner_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    slug: varchar("slug", { length: 128 }).notNull(),
    name: text("name").notNull(),
    description: text("description"),
    visibility: varchar("visibility", { length: 32 })
      .default("private")
      .notNull(),
    metadata: jsonb("metadata")
      .$type<JsonRecord>()
      .default(emptyObject)
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("benchmarks_slug_idx").on(table.slug),
    index("benchmarks_owner_user_id_idx").on(table.ownerUserId),
  ],
);

export const githubIssues = pgTable(
  "github_issues",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    repoOwner: text("repo_owner").notNull(),
    repoName: text("repo_name").notNull(),
    issueNumber: integer("issue_number").notNull(),
    nodeId: text("node_id"),
    url: text("url").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    authorLogin: text("author_login"),
    state: varchar("state", { length: 32 }).notNull(),
    labels: jsonb("labels").$type<JsonRecord[]>().default(emptyArray).notNull(),
    comments: jsonb("comments")
      .$type<JsonRecord[]>()
      .default(emptyArray)
      .notNull(),
    timelineEvents: jsonb("timeline_events")
      .$type<JsonRecord[]>()
      .default(emptyArray)
      .notNull(),
    raw: jsonb("raw").$type<JsonRecord>().default(emptyObject).notNull(),
    openedAt: timestamp("opened_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    fetchedAt: timestamp("fetched_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("github_issues_url_idx").on(table.url),
    uniqueIndex("github_issues_repo_number_idx").on(
      table.repoOwner,
      table.repoName,
      table.issueNumber,
    ),
  ],
);

export const githubPullRequests = pgTable(
  "github_pull_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    issueId: uuid("issue_id").references(() => githubIssues.id, {
      onDelete: "set null",
    }),
    repoOwner: text("repo_owner").notNull(),
    repoName: text("repo_name").notNull(),
    prNumber: integer("pr_number").notNull(),
    nodeId: text("node_id"),
    url: text("url").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    authorLogin: text("author_login"),
    state: varchar("state", { length: 32 }).notNull(),
    baseRef: text("base_ref"),
    baseSha: varchar("base_sha", { length: 64 }).notNull(),
    headRef: text("head_ref"),
    headSha: varchar("head_sha", { length: 64 }).notNull(),
    mergeSha: varchar("merge_sha", { length: 64 }),
    changedFiles: jsonb("changed_files")
      .$type<JsonRecord[]>()
      .default(emptyArray)
      .notNull(),
    raw: jsonb("raw").$type<JsonRecord>().default(emptyObject).notNull(),
    openedAt: timestamp("opened_at", { withTimezone: true }),
    mergedAt: timestamp("merged_at", { withTimezone: true }),
    fetchedAt: timestamp("fetched_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("github_pull_requests_url_idx").on(table.url),
    uniqueIndex("github_pull_requests_repo_number_idx").on(
      table.repoOwner,
      table.repoName,
      table.prNumber,
    ),
    index("github_pull_requests_issue_id_idx").on(table.issueId),
  ],
);

export const artifacts = pgTable(
  "artifacts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    kind: artifactKind("kind").notNull(),
    storageProvider: varchar("storage_provider", { length: 64 }).notNull(),
    bucket: text("bucket"),
    objectKey: text("object_key").notNull(),
    sha256: varchar("sha256", { length: 64 }).notNull(),
    byteSize: integer("byte_size"),
    contentType: text("content_type"),
    metadata: jsonb("metadata")
      .$type<JsonRecord>()
      .default(emptyObject)
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("artifacts_storage_object_idx").on(
      table.storageProvider,
      table.bucket,
      table.objectKey,
    ),
    index("artifacts_sha256_idx").on(table.sha256),
    index("artifacts_kind_idx").on(table.kind),
  ],
);

export const benchmarkCases = pgTable(
  "benchmark_cases",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    benchmarkId: uuid("benchmark_id").references(() => benchmarks.id, {
      onDelete: "set null",
    }),
    githubIssueId: uuid("github_issue_id").references(() => githubIssues.id, {
      onDelete: "set null",
    }),
    slug: varchar("slug", { length: 160 }).notNull(),
    title: text("title").notNull(),
    status: caseStatus("status").default("draft").notNull(),
    tags: jsonb("tags").$type<string[]>().default(emptyArray).notNull(),
    languageHints: jsonb("language_hints")
      .$type<string[]>()
      .default(emptyArray)
      .notNull(),
    difficulty: varchar("difficulty", { length: 64 }),
    leakageWarnings: jsonb("leakage_warnings")
      .$type<JsonRecord[]>()
      .default(emptyArray)
      .notNull(),
    metadata: jsonb("metadata")
      .$type<JsonRecord>()
      .default(emptyObject)
      .notNull(),
    frozenAt: timestamp("frozen_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("benchmark_cases_slug_idx").on(table.slug),
    index("benchmark_cases_benchmark_id_idx").on(table.benchmarkId),
    index("benchmark_cases_github_issue_id_idx").on(table.githubIssueId),
    index("benchmark_cases_status_idx").on(table.status),
  ],
);

export const caseVersions = pgTable(
  "case_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => benchmarkCases.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    status: caseVersionStatus("status").default("candidate").notNull(),
    githubIssueId: uuid("github_issue_id").references(() => githubIssues.id, {
      onDelete: "set null",
    }),
    githubPullRequestId: uuid("github_pull_request_id").references(
      () => githubPullRequests.id,
      {
        onDelete: "set null",
      },
    ),
    issueArtifactId: uuid("issue_artifact_id").references(() => artifacts.id, {
      onDelete: "set null",
    }),
    pullRequestArtifactId: uuid("pull_request_artifact_id").references(
      () => artifacts.id,
      {
        onDelete: "set null",
      },
    ),
    repositoryMetadataArtifactId: uuid(
      "repository_metadata_artifact_id",
    ).references(() => artifacts.id, { onDelete: "set null" }),
    goldPatchArtifactId: uuid("gold_patch_artifact_id").references(
      () => artifacts.id,
      {
        onDelete: "set null",
      },
    ),
    testPatchArtifactId: uuid("test_patch_artifact_id").references(
      () => artifacts.id,
      {
        onDelete: "set null",
      },
    ),
    validationLogArtifactId: uuid("validation_log_artifact_id").references(
      () => artifacts.id,
      {
        onDelete: "set null",
      },
    ),
    repoOwner: text("repo_owner").notNull(),
    repoName: text("repo_name").notNull(),
    baseCommitSha: varchar("base_commit_sha", { length: 64 }).notNull(),
    goldCommitSha: varchar("gold_commit_sha", { length: 64 }),
    environmentRecipe: jsonb("environment_recipe")
      .$type<JsonRecord>()
      .default(emptyObject)
      .notNull(),
    setupCommands: jsonb("setup_commands")
      .$type<string[]>()
      .default(emptyArray)
      .notNull(),
    testCommands: jsonb("test_commands")
      .$type<string[]>()
      .default(emptyArray)
      .notNull(),
    promptVersions: jsonb("prompt_versions")
      .$type<JsonRecord>()
      .default(emptyObject)
      .notNull(),
    testBuilderModelId: text("test_builder_model_id"),
    validationRunnerVersion: text("validation_runner_version"),
    metadata: jsonb("metadata")
      .$type<JsonRecord>()
      .default(emptyObject)
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    frozenAt: timestamp("frozen_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("case_versions_case_id_version_idx").on(
      table.caseId,
      table.version,
    ),
    index("case_versions_case_id_idx").on(table.caseId),
    index("case_versions_status_idx").on(table.status),
    index("case_versions_github_pr_id_idx").on(table.githubPullRequestId),
  ],
);

export const modelVersions = pgTable(
  "model_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    gateway: varchar("gateway", { length: 64 }).default("openrouter").notNull(),
    modelId: text("model_id").notNull(),
    name: text("name"),
    provider: text("provider"),
    contextLength: integer("context_length"),
    architecture: jsonb("architecture")
      .$type<JsonRecord>()
      .default(emptyObject)
      .notNull(),
    raw: jsonb("raw").$type<JsonRecord>().default(emptyObject).notNull(),
    syncedAt: timestamp("synced_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("model_versions_gateway_model_synced_idx").on(
      table.gateway,
      table.modelId,
      table.syncedAt,
    ),
    index("model_versions_model_id_idx").on(table.modelId),
  ],
);

export const modelPricingSnapshots = pgTable(
  "model_pricing_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    modelVersionId: uuid("model_version_id").references(
      () => modelVersions.id,
      {
        onDelete: "set null",
      },
    ),
    gateway: varchar("gateway", { length: 64 }).default("openrouter").notNull(),
    modelId: text("model_id").notNull(),
    promptPricePerMillion: numeric("prompt_price_per_million", {
      precision: 18,
      scale: 9,
    }),
    completionPricePerMillion: numeric("completion_price_per_million", {
      precision: 18,
      scale: 9,
    }),
    requestPrice: numeric("request_price", { precision: 18, scale: 9 }),
    imagePrice: numeric("image_price", { precision: 18, scale: 9 }),
    raw: jsonb("raw").$type<JsonRecord>().default(emptyObject).notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("model_pricing_snapshots_model_id_idx").on(table.modelId),
    index("model_pricing_snapshots_captured_at_idx").on(table.capturedAt),
  ],
);

export const harnessVersions = pgTable(
  "harness_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    harness: varchar("harness", { length: 64 }).notNull(),
    version: text("version").notNull(),
    adapterVersion: text("adapter_version"),
    metadata: jsonb("metadata")
      .$type<JsonRecord>()
      .default(emptyObject)
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("harness_versions_harness_version_idx").on(
      table.harness,
      table.version,
    ),
  ],
);

export const agentConfigs = pgTable(
  "agent_configs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    mode: experimentMode("mode").notNull(),
    plannerModelVersionId: uuid("planner_model_version_id").references(
      () => modelVersions.id,
      {
        onDelete: "set null",
      },
    ),
    implementerModelVersionId: uuid("implementer_model_version_id").references(
      () => modelVersions.id,
      { onDelete: "set null" },
    ),
    harnessVersionId: uuid("harness_version_id").references(
      () => harnessVersions.id,
      {
        onDelete: "set null",
      },
    ),
    toolPolicy: jsonb("tool_policy")
      .$type<JsonRecord>()
      .default(emptyObject)
      .notNull(),
    modelSettings: jsonb("model_settings")
      .$type<JsonRecord>()
      .default(emptyObject)
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("agent_configs_mode_idx").on(table.mode),
    index("agent_configs_harness_version_id_idx").on(table.harnessVersionId),
  ],
);

export const experiments = pgTable(
  "experiments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    benchmarkId: uuid("benchmark_id").references(() => benchmarks.id, {
      onDelete: "set null",
    }),
    datasetId: uuid("dataset_id").references(() => datasets.id, {
      onDelete: "set null",
    }),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    description: text("description"),
    mode: experimentMode("mode").notNull(),
    status: runStatus("status").default("queued").notNull(),
    matrix: jsonb("matrix").$type<JsonRecord>().default(emptyObject).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    index("experiments_benchmark_id_idx").on(table.benchmarkId),
    index("experiments_status_idx").on(table.status),
  ],
);

export const experimentAgentConfigs = pgTable(
  "experiment_agent_configs",
  {
    experimentId: uuid("experiment_id")
      .notNull()
      .references(() => experiments.id, { onDelete: "cascade" }),
    agentConfigId: uuid("agent_config_id")
      .notNull()
      .references(() => agentConfigs.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.experimentId, table.agentConfigId] }),
  ],
);

export const experimentCaseVersions = pgTable(
  "experiment_case_versions",
  {
    experimentId: uuid("experiment_id")
      .notNull()
      .references(() => experiments.id, { onDelete: "cascade" }),
    caseVersionId: uuid("case_version_id")
      .notNull()
      .references(() => caseVersions.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.experimentId, table.caseVersionId] }),
  ],
);

export const runGroups = pgTable(
  "run_groups",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    experimentId: uuid("experiment_id")
      .notNull()
      .references(() => experiments.id, { onDelete: "cascade" }),
    caseVersionId: uuid("case_version_id").references(() => caseVersions.id, {
      onDelete: "set null",
    }),
    agentConfigId: uuid("agent_config_id").references(() => agentConfigs.id, {
      onDelete: "set null",
    }),
    name: text("name"),
    status: runStatus("status").default("queued").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    index("run_groups_experiment_id_idx").on(table.experimentId),
    index("run_groups_case_version_id_idx").on(table.caseVersionId),
    index("run_groups_status_idx").on(table.status),
  ],
);

export const runs = pgTable(
  "runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    experimentId: uuid("experiment_id").references(() => experiments.id, {
      onDelete: "set null",
    }),
    runGroupId: uuid("run_group_id").references(() => runGroups.id, {
      onDelete: "set null",
    }),
    caseVersionId: uuid("case_version_id").references(() => caseVersions.id, {
      onDelete: "set null",
    }),
    agentConfigId: uuid("agent_config_id").references(() => agentConfigs.id, {
      onDelete: "set null",
    }),
    harnessVersionId: uuid("harness_version_id").references(
      () => harnessVersions.id,
      {
        onDelete: "set null",
      },
    ),
    plannerModelVersionId: uuid("planner_model_version_id").references(
      () => modelVersions.id,
      {
        onDelete: "set null",
      },
    ),
    implementerModelVersionId: uuid("implementer_model_version_id").references(
      () => modelVersions.id,
      { onDelete: "set null" },
    ),
    pricingSnapshotId: uuid("pricing_snapshot_id").references(
      () => modelPricingSnapshots.id,
      {
        onDelete: "set null",
      },
    ),
    mode: experimentMode("mode").notNull(),
    status: runStatus("status").default("queued").notNull(),
    stage: runCurrentStage("stage"),
    parentRunId: uuid("parent_run_id").references((): AnyPgColumn => runs.id, {
      onDelete: "set null",
    }),
    openRouterModelId: text("openrouter_model_id"),
    providerRoutingConfig: jsonb("provider_routing_config")
      .$type<JsonRecord>()
      .default(emptyObject)
      .notNull(),
    fallbackPolicy: jsonb("fallback_policy")
      .$type<JsonRecord>()
      .default(emptyObject)
      .notNull(),
    resolvedUpstreamProvider: text("resolved_upstream_provider"),
    requestId: text("request_id"),
    generationId: text("generation_id"),
    rawUsage: jsonb("raw_usage")
      .$type<JsonRecord>()
      .default(emptyObject)
      .notNull(),
    chargedCost: numeric("charged_cost", { precision: 18, scale: 9 }),
    computedCost: numeric("computed_cost", { precision: 18, scale: 9 }),
    error: jsonb("error").$type<JsonRecord>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    index("runs_experiment_id_idx").on(table.experimentId),
    index("runs_run_group_id_idx").on(table.runGroupId),
    index("runs_case_version_id_idx").on(table.caseVersionId),
    index("runs_status_idx").on(table.status),
    index("runs_openrouter_model_id_idx").on(table.openRouterModelId),
  ],
);

export const runEvents = pgTable(
  "run_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    artifactId: uuid("artifact_id").references(() => artifacts.id, {
      onDelete: "set null",
    }),
    seq: integer("seq").notNull(),
    ts: timestamp("ts", { withTimezone: true }).defaultNow().notNull(),
    stage: runStage("stage").notNull(),
    kind: runEventKind("kind").notNull(),
    payload: jsonb("payload").$type<unknown>().notNull(),
  },
  (table) => [
    uniqueIndex("run_events_run_id_seq_idx").on(table.runId, table.seq),
    index("run_events_run_id_ts_idx").on(table.runId, table.ts),
    index("run_events_kind_idx").on(table.kind),
  ],
);

export const plans = pgTable(
  "plans",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id").references(() => runs.id, { onDelete: "set null" }),
    caseVersionId: uuid("case_version_id").references(() => caseVersions.id, {
      onDelete: "set null",
    }),
    rawArtifactId: uuid("raw_artifact_id").references(() => artifacts.id, {
      onDelete: "set null",
    }),
    formatVersion: text("format_version").notNull(),
    planMarkdown: text("plan_markdown"),
    planJson: jsonb("plan_json")
      .$type<JsonRecord>()
      .default(emptyObject)
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("plans_run_id_idx").on(table.runId),
    index("plans_case_version_id_idx").on(table.caseVersionId),
  ],
);

export const goldEditAtoms = pgTable(
  "gold_edit_atoms",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    caseVersionId: uuid("case_version_id")
      .notNull()
      .references(() => caseVersions.id, { onDelete: "cascade" }),
    sourcePatchArtifactId: uuid("source_patch_artifact_id").references(
      () => artifacts.id,
      {
        onDelete: "set null",
      },
    ),
    atomKey: text("atom_key"),
    filePath: text("file_path").notNull(),
    symbol: text("symbol"),
    behavior: text("behavior").notNull(),
    required: boolean("required").default(true).notNull(),
    weight: numeric("weight", { precision: 8, scale: 4 }).notNull(),
    humanEdited: boolean("human_edited").default(false).notNull(),
    metadata: jsonb("metadata")
      .$type<JsonRecord>()
      .default(emptyObject)
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("gold_edit_atoms_case_version_id_idx").on(table.caseVersionId),
    index("gold_edit_atoms_file_path_idx").on(table.filePath),
  ],
);

export const planScores = pgTable(
  "plan_scores",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => plans.id, { onDelete: "cascade" }),
    caseVersionId: uuid("case_version_id").references(() => caseVersions.id, {
      onDelete: "set null",
    }),
    judgeModelVersionId: uuid("judge_model_version_id").references(
      () => modelVersions.id,
      {
        onDelete: "set null",
      },
    ),
    pricingSnapshotId: uuid("pricing_snapshot_id").references(
      () => modelPricingSnapshots.id,
      {
        onDelete: "set null",
      },
    ),
    rubricVersion: text("rubric_version").notNull(),
    promptVersion: text("prompt_version").notNull(),
    judgeRunOrdinal: integer("judge_run_ordinal").default(1).notNull(),
    overallScore: numeric("overall_score", {
      precision: 8,
      scale: 4,
    }).notNull(),
    correctnessScore: integer("correctness_score"),
    completenessScore: integer("completeness_score"),
    safetyScore: integer("safety_score"),
    dimensions: jsonb("dimensions")
      .$type<JsonRecord>()
      .default(emptyObject)
      .notNull(),
    atomMatches: jsonb("atom_matches")
      .$type<JsonRecord[]>()
      .default(emptyArray)
      .notNull(),
    rationale: text("rationale"),
    isPublic: boolean("is_public").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("plan_scores_plan_id_idx").on(table.planId),
    index("plan_scores_case_version_id_idx").on(table.caseVersionId),
    index("plan_scores_public_idx").on(table.isPublic),
  ],
);

export const patches = pgTable(
  "patches",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id").references(() => runs.id, { onDelete: "set null" }),
    caseVersionId: uuid("case_version_id").references(() => caseVersions.id, {
      onDelete: "set null",
    }),
    artifactId: uuid("artifact_id").references(() => artifacts.id, {
      onDelete: "set null",
    }),
    kind: patchKind("kind").notNull(),
    summary: text("summary"),
    stats: jsonb("stats").$type<JsonRecord>().default(emptyObject).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("patches_run_id_idx").on(table.runId),
    index("patches_case_version_id_idx").on(table.caseVersionId),
    index("patches_kind_idx").on(table.kind),
  ],
);

export const evaluations = pgTable(
  "evaluations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id").references(() => runs.id, { onDelete: "set null" }),
    patchId: uuid("patch_id").references(() => patches.id, {
      onDelete: "set null",
    }),
    caseVersionId: uuid("case_version_id").references(() => caseVersions.id, {
      onDelete: "set null",
    }),
    logArtifactId: uuid("log_artifact_id").references(() => artifacts.id, {
      onDelete: "set null",
    }),
    evaluatorVersion: text("evaluator_version").notNull(),
    status: evaluationStatus("status").default("queued").notNull(),
    resolved: boolean("resolved").default(false).notNull(),
    failToPassPassed: integer("fail_to_pass_passed").default(0).notNull(),
    failToPassTotal: integer("fail_to_pass_total").default(0).notNull(),
    passToPassPassed: integer("pass_to_pass_passed").default(0).notNull(),
    passToPassTotal: integer("pass_to_pass_total").default(0).notNull(),
    diffSimilarityScore: numeric("diff_similarity_score", {
      precision: 8,
      scale: 4,
    }),
    rawResults: jsonb("raw_results")
      .$type<JsonRecord>()
      .default(emptyObject)
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    index("evaluations_run_id_idx").on(table.runId),
    index("evaluations_patch_id_idx").on(table.patchId),
    index("evaluations_case_version_id_idx").on(table.caseVersionId),
    index("evaluations_status_idx").on(table.status),
  ],
);

export const graderVerdicts = pgTable(
  "grader_verdicts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    experimentId: uuid("experiment_id").references(() => experiments.id, {
      onDelete: "set null",
    }),
    runAId: uuid("run_a_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    runBId: uuid("run_b_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    winnerRunId: uuid("winner_run_id").references(() => runs.id, {
      onDelete: "set null",
    }),
    reasoning: text("reasoning"),
    metadata: jsonb("metadata")
      .$type<JsonRecord>()
      .default(emptyObject)
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("grader_verdicts_experiment_id_idx").on(table.experimentId),
    index("grader_verdicts_run_a_id_idx").on(table.runAId),
    index("grader_verdicts_run_b_id_idx").on(table.runBId),
  ],
);

export const validationAttempts = pgTable(
  "validation_attempts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    caseVersionId: uuid("case_version_id")
      .notNull()
      .references(() => caseVersions.id, { onDelete: "cascade" }),
    candidateTestsArtifactId: uuid("candidate_tests_artifact_id").references(
      () => artifacts.id,
      {
        onDelete: "set null",
      },
    ),
    baseLogArtifactId: uuid("base_log_artifact_id").references(
      () => artifacts.id,
      {
        onDelete: "set null",
      },
    ),
    goldLogArtifactId: uuid("gold_log_artifact_id").references(
      () => artifacts.id,
      {
        onDelete: "set null",
      },
    ),
    runnerVersion: text("runner_version").notNull(),
    status: validationStatus("status").default("queued").notNull(),
    attemptNumber: integer("attempt_number").default(1).notNull(),
    strategy: validationStrategy("strategy").default("unit_tests").notNull(),
    previousAttemptId: uuid("previous_attempt_id"),
    acceptedTestCount: integer("accepted_test_count").default(0).notNull(),
    rejectedTestCount: integer("rejected_test_count").default(0).notNull(),
    rawResults: jsonb("raw_results")
      .$type<JsonRecord>()
      .default(emptyObject)
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    index("validation_attempts_case_version_id_idx").on(table.caseVersionId),
    index("validation_attempts_status_idx").on(table.status),
    index("validation_attempts_strategy_idx").on(table.strategy),
  ],
);

export const testSpecs = pgTable(
  "test_specs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    caseVersionId: uuid("case_version_id")
      .notNull()
      .references(() => caseVersions.id, { onDelete: "cascade" }),
    validationAttemptId: uuid("validation_attempt_id").references(
      () => validationAttempts.id,
      {
        onDelete: "set null",
      },
    ),
    name: text("name").notNull(),
    kind: testSpecKind("kind").notNull(),
    status: testSpecStatus("status").default("proposed").notNull(),
    filePath: text("file_path"),
    testCommand: text("test_command").notNull(),
    expectedFailureMode: text("expected_failure_mode"),
    expectedPassMode: text("expected_pass_mode"),
    content: text("content"),
    metadata: jsonb("metadata")
      .$type<JsonRecord>()
      .default(emptyObject)
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("test_specs_case_version_id_idx").on(table.caseVersionId),
    index("test_specs_validation_attempt_id_idx").on(table.validationAttemptId),
    index("test_specs_kind_status_idx").on(table.kind, table.status),
  ],
);

export const reproductionSteps = pgTable(
  "reproduction_steps",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    caseVersionId: uuid("case_version_id")
      .notNull()
      .references(() => caseVersions.id, { onDelete: "cascade" }),
    validationAttemptId: uuid("validation_attempt_id").references(
      () => validationAttempts.id,
      { onDelete: "set null" },
    ),
    steps: jsonb("steps")
      .$type<{ description: string; command: string }[]>()
      .notNull(),
    script: text("script").notNull(),
    rationale: text("rationale"),
    status: reproductionStepStatus("status").default("proposed").notNull(),
    reproducedOnBase: boolean("reproduced_on_base"),
    fixedOnGold: boolean("fixed_on_gold"),
    metadata: jsonb("metadata")
      .$type<JsonRecord>()
      .default(emptyObject)
      .notNull(),
    rawResults: jsonb("raw_results")
      .$type<JsonRecord>()
      .default(emptyObject)
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("reproduction_steps_case_version_id_idx").on(table.caseVersionId),
    index("reproduction_steps_validation_attempt_id_idx").on(
      table.validationAttemptId,
    ),
    index("reproduction_steps_status_idx").on(table.status),
  ],
);

export const benchmarksRelations = relations(benchmarks, ({ many, one }) => ({
  owner: one(users, {
    fields: [benchmarks.ownerUserId],
    references: [users.id],
  }),
  cases: many(benchmarkCases),
  experiments: many(experiments),
}));

export const benchmarkCasesRelations = relations(
  benchmarkCases,
  ({ many, one }) => ({
    benchmark: one(benchmarks, {
      fields: [benchmarkCases.benchmarkId],
      references: [benchmarks.id],
    }),
    githubIssue: one(githubIssues, {
      fields: [benchmarkCases.githubIssueId],
      references: [githubIssues.id],
    }),
    versions: many(caseVersions),
  }),
);

export const caseVersionsRelations = relations(
  caseVersions,
  ({ many, one }) => ({
    benchmarkCase: one(benchmarkCases, {
      fields: [caseVersions.caseId],
      references: [benchmarkCases.id],
    }),
    githubIssue: one(githubIssues, {
      fields: [caseVersions.githubIssueId],
      references: [githubIssues.id],
    }),
    githubPullRequest: one(githubPullRequests, {
      fields: [caseVersions.githubPullRequestId],
      references: [githubPullRequests.id],
    }),
    runs: many(runs),
    atoms: many(goldEditAtoms),
    testSpecs: many(testSpecs),
    validationAttempts: many(validationAttempts),
    reproductionSteps: many(reproductionSteps),
  }),
);

export const testSpecsRelations = relations(testSpecs, ({ one }) => ({
  caseVersion: one(caseVersions, {
    fields: [testSpecs.caseVersionId],
    references: [caseVersions.id],
  }),
  validationAttempt: one(validationAttempts, {
    fields: [testSpecs.validationAttemptId],
    references: [validationAttempts.id],
  }),
}));

export const reproductionStepsRelations = relations(
  reproductionSteps,
  ({ one }) => ({
    caseVersion: one(caseVersions, {
      fields: [reproductionSteps.caseVersionId],
      references: [caseVersions.id],
    }),
    validationAttempt: one(validationAttempts, {
      fields: [reproductionSteps.validationAttemptId],
      references: [validationAttempts.id],
    }),
  }),
);

export const datasetStatus = pgEnum("dataset_status", [
  "draft",
  "active",
  "archived",
]);

export const datasets = pgTable(
  "datasets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    slug: varchar("slug", { length: 160 }).notNull(),
    name: text("name").notNull(),
    description: text("description"),
    status: datasetStatus("status").default("draft").notNull(),
    tags: jsonb("tags").$type<string[]>().default(emptyArray).notNull(),
    metadata: jsonb("metadata")
      .$type<JsonRecord>()
      .default(emptyObject)
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("datasets_slug_idx").on(table.slug),
    index("datasets_status_idx").on(table.status),
  ],
);

export const datasetCases = pgTable(
  "dataset_cases",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    datasetId: uuid("dataset_id")
      .notNull()
      .references(() => datasets.id, { onDelete: "cascade" }),
    caseId: uuid("case_id")
      .notNull()
      .references(() => benchmarkCases.id, { onDelete: "cascade" }),
    orderIndex: integer("order_index").default(0).notNull(),
    metadata: jsonb("metadata")
      .$type<JsonRecord>()
      .default(emptyObject)
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("dataset_cases_unique_idx").on(table.datasetId, table.caseId),
    index("dataset_cases_case_id_idx").on(table.caseId),
  ],
);

export const experimentsRelations = relations(experiments, ({ many, one }) => ({
  benchmark: one(benchmarks, {
    fields: [experiments.benchmarkId],
    references: [benchmarks.id],
  }),
  runGroups: many(runGroups),
  runs: many(runs),
  agentConfigs: many(experimentAgentConfigs),
  caseVersions: many(experimentCaseVersions),
  graderVerdicts: many(graderVerdicts),
}));

export const experimentAgentConfigsRelations = relations(
  experimentAgentConfigs,
  ({ one }) => ({
    experiment: one(experiments, {
      fields: [experimentAgentConfigs.experimentId],
      references: [experiments.id],
    }),
    agentConfig: one(agentConfigs, {
      fields: [experimentAgentConfigs.agentConfigId],
      references: [agentConfigs.id],
    }),
  }),
);

export const experimentCaseVersionsRelations = relations(
  experimentCaseVersions,
  ({ one }) => ({
    experiment: one(experiments, {
      fields: [experimentCaseVersions.experimentId],
      references: [experiments.id],
    }),
    caseVersion: one(caseVersions, {
      fields: [experimentCaseVersions.caseVersionId],
      references: [caseVersions.id],
    }),
  }),
);

export const graderVerdictsRelations = relations(
  graderVerdicts,
  ({ one }) => ({
    experiment: one(experiments, {
      fields: [graderVerdicts.experimentId],
      references: [experiments.id],
    }),
    runA: one(runs, {
      fields: [graderVerdicts.runAId],
      references: [runs.id],
    }),
    runB: one(runs, {
      fields: [graderVerdicts.runBId],
      references: [runs.id],
    }),
    winnerRun: one(runs, {
      fields: [graderVerdicts.winnerRunId],
      references: [runs.id],
    }),
  }),
);

export const runsRelations = relations(runs, ({ many, one }) => ({
  experiment: one(experiments, {
    fields: [runs.experimentId],
    references: [experiments.id],
  }),
  runGroup: one(runGroups, {
    fields: [runs.runGroupId],
    references: [runGroups.id],
  }),
  caseVersion: one(caseVersions, {
    fields: [runs.caseVersionId],
    references: [caseVersions.id],
  }),
  events: many(runEvents),
  plans: many(plans),
  patches: many(patches),
  evaluations: many(evaluations),
}));

export const plansRelations = relations(plans, ({ many, one }) => ({
  run: one(runs, {
    fields: [plans.runId],
    references: [runs.id],
  }),
  scores: many(planScores),
}));

export const validationAttemptsRelations = relations(
  validationAttempts,
  ({ many, one }) => ({
    caseVersion: one(caseVersions, {
      fields: [validationAttempts.caseVersionId],
      references: [caseVersions.id],
    }),
    testSpecs: many(testSpecs),
    reproductionSteps: many(reproductionSteps),
  }),
);

export const datasetsRelations = relations(datasets, ({ many }) => ({
  cases: many(datasetCases),
}));

export const datasetCasesRelations = relations(datasetCases, ({ one }) => ({
  dataset: one(datasets, {
    fields: [datasetCases.datasetId],
    references: [datasets.id],
  }),
  benchmarkCase: one(benchmarkCases, {
    fields: [datasetCases.caseId],
    references: [benchmarkCases.id],
  }),
}));

export const benchmarkCasesToBenchmarks = pgTable(
  "benchmark_cases_to_benchmarks",
  {
    benchmarkId: uuid("benchmark_id")
      .notNull()
      .references(() => benchmarks.id, { onDelete: "cascade" }),
    caseId: uuid("case_id")
      .notNull()
      .references(() => benchmarkCases.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.benchmarkId, table.caseId] }),
    index("benchmark_cases_to_benchmarks_case_id_idx").on(table.caseId),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Benchmark = typeof benchmarks.$inferSelect;
export type NewBenchmark = typeof benchmarks.$inferInsert;
export type BenchmarkCase = typeof benchmarkCases.$inferSelect;
export type NewBenchmarkCase = typeof benchmarkCases.$inferInsert;
export type CaseVersion = typeof caseVersions.$inferSelect;
export type NewCaseVersion = typeof caseVersions.$inferInsert;
export type GithubIssue = typeof githubIssues.$inferSelect;
export type NewGithubIssue = typeof githubIssues.$inferInsert;
export type GithubPullRequest = typeof githubPullRequests.$inferSelect;
export type NewGithubPullRequest = typeof githubPullRequests.$inferInsert;
export type Artifact = typeof artifacts.$inferSelect;
export type NewArtifact = typeof artifacts.$inferInsert;
export type ModelVersion = typeof modelVersions.$inferSelect;
export type NewModelVersion = typeof modelVersions.$inferInsert;
export type ModelPricingSnapshot = typeof modelPricingSnapshots.$inferSelect;
export type NewModelPricingSnapshot = typeof modelPricingSnapshots.$inferInsert;
export type Experiment = typeof experiments.$inferSelect;
export type NewExperiment = typeof experiments.$inferInsert;
export type Run = typeof runs.$inferSelect;
export type NewRun = typeof runs.$inferInsert;
export type RunEvent = typeof runEvents.$inferSelect;
export type NewRunEvent = typeof runEvents.$inferInsert;
export type Plan = typeof plans.$inferSelect;
export type NewPlan = typeof plans.$inferInsert;
export type GoldEditAtom = typeof goldEditAtoms.$inferSelect;
export type NewGoldEditAtom = typeof goldEditAtoms.$inferInsert;
export type PlanScore = typeof planScores.$inferSelect;
export type NewPlanScore = typeof planScores.$inferInsert;
export type Patch = typeof patches.$inferSelect;
export type NewPatch = typeof patches.$inferInsert;
export type Evaluation = typeof evaluations.$inferSelect;
export type NewEvaluation = typeof evaluations.$inferInsert;
export type ValidationAttempt = typeof validationAttempts.$inferSelect;
export type NewValidationAttempt = typeof validationAttempts.$inferInsert;
export type TestSpec = typeof testSpecs.$inferSelect;
export type NewTestSpec = typeof testSpecs.$inferInsert;
export type Dataset = typeof datasets.$inferSelect;
export type NewDataset = typeof datasets.$inferInsert;
export type DatasetCase = typeof datasetCases.$inferSelect;
export type NewDatasetCase = typeof datasetCases.$inferInsert;
export type ExperimentAgentConfig = typeof experimentAgentConfigs.$inferSelect;
export type NewExperimentAgentConfig = typeof experimentAgentConfigs.$inferInsert;
export type ExperimentCaseVersion = typeof experimentCaseVersions.$inferSelect;
export type NewExperimentCaseVersion = typeof experimentCaseVersions.$inferInsert;
export type GraderVerdict = typeof graderVerdicts.$inferSelect;
export type NewGraderVerdict = typeof graderVerdicts.$inferInsert;
export type ReproductionStep = typeof reproductionSteps.$inferSelect;
export type NewReproductionStep = typeof reproductionSteps.$inferInsert;
