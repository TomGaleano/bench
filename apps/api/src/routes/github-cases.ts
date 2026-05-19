import { eq } from "drizzle-orm";
import type { DbClient } from "@pilab/db";
import {
  artifacts,
  benchmarkCases,
  caseVersions,
  githubIssues,
  githubPullRequests,
  reproductionSteps,
  runs,
  testSpecs,
  validationAttempts,
  type BenchmarkCase
} from "@pilab/db/schema";
import {
  buildGitHubPullRequestUrl,
  buildPullRequestCandidateSearchQuery,
  createGitHubClient,
  discoverPullRequestCandidates,
  fetchGitHubPullRequestDiff,
  importGitHubIssue,
  importGitHubPullRequestDetail,
  parseGitHubIssueUrl,
  parseGitHubPullRequestUrl,
  searchGitHubPullRequests,
  type GitHubIssue,
  type GitHubIssueRef,
  type GitHubPullRequestFile,
  type GitHubPullRequestRef,
  type PullRequestCandidate
} from "@pilab/github";
import {
  createCaseBuilderQueue,
  createRedisConnection,
  createValidationRunnerQueue,
  enqueueCaseBuilderPrepareJob,
  getCaseBuilderJobSummary,
  getQueueStatus,
  getValidationRunnerJobSummary,
  type CaseBuilderJobSummary,
  type CaseBuilderQueue,
  type QueueStatus,
  type ValidationRunnerJobSummary,
  type ValidationRunnerQueue
} from "@pilab/jobs";
import type { FastifyPluginAsync } from "fastify";
import { createApiObjectStore, toJsonValue } from "../object-store.js";
import type { GitHubCase, GitHubCaseCreateRequest } from "../types.js";

type JsonRecord = Record<string, unknown>;
type ArtifactKind = (typeof artifacts.$inferInsert)["kind"];
type StoredJsonArtifact = Awaited<ReturnType<ReturnType<typeof createApiObjectStore>["putJsonArtifact"]>>;

type GitHubCasePayload = {
  kind: "github_case_payload";
  body: string;
  runId?: string;
  metadata: Record<string, unknown>;
};

type GitHubIssueImportRequest = {
  issueUrl: string;
};

type ImportedIssueSummary = {
  id: string;
  repoOwner: string;
  repoName: string;
  issueNumber: number;
  url: string;
  title: string;
  state: string;
  labels: string[];
  commentCount: number;
  timelineEventCount: number;
};

type GitHubIssueImportReply = {
  case: GitHubCase;
  issue: ImportedIssueSummary;
  prCandidates: PullRequestCandidate[];
  needsPrSelection: boolean;
  warnings: string[];
};

type GitHubPrSelectionRequest = {
  prUrl?: string;
  prNumber?: number;
};

type CaseVersionSummary = {
  id: string;
  version: number;
  status: string;
};

type ArtifactSummary = {
  id: string;
  kind: string;
  objectKey: string;
  sha256: string;
  byteSize: number;
  contentType: string;
};

type SelectedPullRequestSummary = {
  id: string;
  repoOwner: string;
  repoName: string;
  prNumber: number;
  url: string;
  title: string;
  state: string;
  baseRef: string | null;
  baseSha: string;
  headRef: string | null;
  headSha: string;
  mergeSha: string | null;
  changedFileCount: number;
  mergedAt: string | null;
};

type ChangedFileSummary = {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch?: string | undefined;
};

type SweBenchStyleEntrySummary = {
  schemaVersion: "pilab.swe-bench-style-entry.v1";
  instanceId: string;
  repo: string;
  issueNumber: number;
  pullNumber: number;
  baseCommit: string;
  goldCommit: string;
  problemStatement: string;
  issueUrl: string;
  prUrl: string;
  patchSource: "github_pull_request";
  testSource: "llm_proposed_pending_validation";
  failToPass: string[];
  passToPass: string[];
};

type GitHubPrSelectionReply = {
  case: GitHubCase;
  caseVersion: CaseVersionSummary;
  artifacts: ArtifactSummary[];
  caseBuilderJob: CaseBuilderJobSummary;
  sweBenchStyleEntry: SweBenchStyleEntrySummary;
  pullRequest: SelectedPullRequestSummary;
  changedFiles: ChangedFileSummary[];
};

type CaseBuilderJobParams = {
  jobId: string;
};

type ValidationRunnerJobParams = {
  jobId: string;
};

const githubCasePayloadKind = "github_case_payload";

function createSlug() {
  return `github-case-${crypto.randomUUID()}`;
}

function createIssueCaseSlug(issue: GitHubIssueRef) {
  const owner = slugPart(issue.owner);
  const repo = slugPart(issue.repo);
  const entropy = crypto.randomUUID().slice(0, 8);
  return `github-${owner}-${repo}-${issue.issueNumber}-${entropy}`.slice(0, 160);
}

function readPayload(row: BenchmarkCase): GitHubCasePayload {
  const payload =
    row.metadata.kind === githubCasePayloadKind
      ? (row.metadata as GitHubCasePayload)
      : undefined;

  const fallbackPayload: GitHubCasePayload = {
    kind: githubCasePayloadKind,
    body: payload?.body ?? "",
    metadata: payload?.metadata ?? {},
  };

  if (payload?.runId) {
    fallbackPayload.runId = payload.runId;
  }

  return fallbackPayload;
}

function toGitHubCase(row: BenchmarkCase): GitHubCase {
  const payload = readPayload(row);
  const githubCase: GitHubCase = {
    id: row.id,
    title: row.title,
    body: payload.body,
    labels: row.tags,
    metadata: payload.metadata,
    status: row.status,
    externalUrl: row.metadata?.externalUrl ? String(row.metadata.externalUrl) : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    frozenAt: row.frozenAt ? row.frozenAt.toISOString() : null,
  };

  if (payload.runId) {
    githubCase.runId = payload.runId;
  }

  return githubCase;
}

function createHttpError(message: string, statusCode: number): Error & { statusCode: number } {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
}

function labelNames(labels: GitHubIssue["labels"]): string[] {
  return labels
    .map((label) => (typeof label === "string" ? label : label.name))
    .filter((name): name is string => Boolean(name));
}

function toJsonRecordArray(items: unknown[]): JsonRecord[] {
  return items.map((item) => {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      return item as JsonRecord;
    }

    return { value: item };
  });
}

function toJsonRecord(value: unknown): JsonRecord {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as JsonRecord;
  }

  return { value };
}

function createSweBenchStyleEntry(input: {
  issue: typeof githubIssues.$inferSelect;
  pullRequest: typeof githubPullRequests.$inferSelect;
  caseVersion: typeof caseVersions.$inferSelect;
}): SweBenchStyleEntrySummary {
  const repo = `${input.caseVersion.repoOwner}/${input.caseVersion.repoName}`;
  const goldCommit = input.caseVersion.goldCommitSha ?? input.pullRequest.headSha;
  const instanceId = `${input.caseVersion.repoOwner}__${input.caseVersion.repoName}-${input.issue.issueNumber}-${input.pullRequest.prNumber}-v${input.caseVersion.version}`;

  return {
    schemaVersion: "pilab.swe-bench-style-entry.v1",
    instanceId,
    repo,
    issueNumber: input.issue.issueNumber,
    pullNumber: input.pullRequest.prNumber,
    baseCommit: input.caseVersion.baseCommitSha,
    goldCommit,
    problemStatement: [
      input.issue.title,
      input.issue.body ?? "",
    ].filter(Boolean).join("\n\n"),
    issueUrl: input.issue.url,
    prUrl: input.pullRequest.url,
    patchSource: "github_pull_request",
    testSource: "llm_proposed_pending_validation",
    failToPass: [],
    passToPass: [],
  };
}

function toDate(value: string | null | undefined): Date | null {
  return value ? new Date(value) : null;
}

function toIso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function slugPart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "repo";
}

function summarizeChangedFile(file: GitHubPullRequestFile): ChangedFileSummary {
  return {
    filename: file.filename,
    status: file.status,
    changes: file.changes,
    additions: file.additions,
    deletions: file.deletions,
    patch: file.patch,
  };
}

function isTestFile(filename: string): boolean {
  const testPatterns = [
    /\.(test|spec)\.(ts|tsx|js|jsx|py|go|rs|java|kt|scala)$/i,
    /tests?\//i,
    /__tests__\//i,
    /test_.*\.py$/i,
    /.*_test\.py$/i,
    /.*_tests?\.go$/i,
  ];
  return testPatterns.some((pattern) => pattern.test(filename));
}

function summarizeArtifact(row: typeof artifacts.$inferSelect): ArtifactSummary {
  return {
    id: row.id,
    kind: row.kind,
    objectKey: row.objectKey,
    sha256: row.sha256,
    byteSize: row.byteSize ?? 0,
    contentType: row.contentType ?? "application/octet-stream",
  };
}

async function nextCaseVersionNumber(
  db: DbClient,
  caseId: string
): Promise<number> {
  const [latestVersion] = await db.query.caseVersions.findMany({
    where: (versions, { eq: equals }) => equals(versions.caseId, caseId),
    orderBy: (versions, { desc }) => [desc(versions.version)],
    limit: 1,
    columns: {
      version: true,
    },
  });

  return (latestVersion?.version ?? 0) + 1;
}

async function persistStoredArtifact(input: {
  db: DbClient;
  kind: ArtifactKind;
  stored: StoredJsonArtifact;
  metadata?: JsonRecord;
}): Promise<typeof artifacts.$inferSelect> {
  const [artifact] = await input.db
    .insert(artifacts)
    .values({
      kind: input.kind,
      storageProvider: "s3",
      bucket: input.stored.bucket,
      objectKey: input.stored.key,
      sha256: input.stored.sha256,
      byteSize: input.stored.sizeBytes,
      contentType: input.stored.contentType,
      metadata: input.metadata ?? {},
    })
    .onConflictDoUpdate({
      target: [artifacts.storageProvider, artifacts.bucket, artifacts.objectKey],
      set: {
        sha256: input.stored.sha256,
        byteSize: input.stored.sizeBytes,
        contentType: input.stored.contentType,
        metadata: input.metadata ?? {},
      },
    })
    .returning();

  if (!artifact) {
    throw new Error("Failed to persist artifact metadata");
  }

  return artifact;
}

function resolvePullRequestRef(input: {
  body: GitHubPrSelectionRequest;
  issue: {
    repoOwner: string;
    repoName: string;
  };
}): GitHubPullRequestRef {
  if (input.body.prUrl) {
    const parsed = parseGitHubPullRequestUrl(input.body.prUrl);

    if (!parsed.ok || !parsed.value) {
      throw createHttpError(`Invalid GitHub PR URL: ${parsed.error ?? "unknown"}`, 400);
    }

    if (
      parsed.value.owner !== input.issue.repoOwner ||
      parsed.value.repo !== input.issue.repoName
    ) {
      throw createHttpError("Pull request must belong to the imported issue repository", 400);
    }

    return parsed.value;
  }

  if (
    input.body.prNumber !== undefined &&
    Number.isSafeInteger(input.body.prNumber) &&
    input.body.prNumber > 0
  ) {
    return {
      owner: input.issue.repoOwner,
      repo: input.issue.repoName,
      pullNumber: input.body.prNumber,
      canonicalUrl: buildGitHubPullRequestUrl({
        owner: input.issue.repoOwner,
        repo: input.issue.repoName,
        pullNumber: input.body.prNumber,
      }),
    };
  }

  throw createHttpError("Provide a PR URL or PR number", 400);
}

function assertCaseMutable(row: BenchmarkCase): void {
  if (row.status === "frozen") {
    throw createHttpError("Case is frozen and cannot be modified", 409);
  }

  if (row.status === "rejected") {
    throw createHttpError("Case is rejected and cannot be modified", 409);
  }

  if (row.status === "archived") {
    throw createHttpError("Case is archived and cannot be modified", 409);
  }
}

type TestSpecSummary = {
  id: string;
  name: string;
  kind: string;
  status: string;
  filePath: string | null;
  testCommand: string;
  expectedFailureMode: string | null;
  expectedPassMode: string | null;
  content: string | null;
  createdAt: string;
};

type ValidationAttemptSummary = {
  id: string;
  status: string;
  attemptNumber: number;
  strategy: string;
  previousAttemptId: string | null;
  acceptedTestCount: number;
  rejectedTestCount: number;
  runnerVersion: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

type ReproductionStepSummary = {
  id: string;
  validationAttemptId: string | null;
  steps: { description: string; command: string }[];
  script: string;
  rationale: string | null;
  status: string;
  reproducedOnBase: boolean | null;
  fixedOnGold: boolean | null;
  createdAt: string;
};

type CaseVersionDetail = {
  id: string;
  caseId: string;
  version: number;
  status: string;
  repoOwner: string;
  repoName: string;
  baseCommitSha: string;
  goldCommitSha: string | null;
  testBuilderModelId: string | null;
  validationRunnerVersion: string | null;
  createdAt: string;
  frozenAt: string | null;
  testSpecs: TestSpecSummary[];
  validationAttempts: ValidationAttemptSummary[];
  reproductionSteps: ReproductionStepSummary[];
};

function toReproductionStepSummary(
  row: typeof reproductionSteps.$inferSelect,
): ReproductionStepSummary {
  return {
    id: row.id,
    validationAttemptId: row.validationAttemptId ?? null,
    steps: row.steps,
    script: row.script,
    rationale: row.rationale ?? null,
    status: row.status,
    reproducedOnBase: row.reproducedOnBase ?? null,
    fixedOnGold: row.fixedOnGold ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function toTestSpecSummary(row: typeof testSpecs.$inferSelect): TestSpecSummary {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    status: row.status,
    filePath: row.filePath ?? null,
    testCommand: row.testCommand,
    expectedFailureMode: row.expectedFailureMode ?? null,
    expectedPassMode: row.expectedPassMode ?? null,
    content: row.content ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function toValidationAttemptSummary(
  row: typeof validationAttempts.$inferSelect,
): ValidationAttemptSummary {
  return {
    id: row.id,
    status: row.status,
    attemptNumber: row.attemptNumber,
    strategy: row.strategy,
    previousAttemptId: row.previousAttemptId ?? null,
    acceptedTestCount: row.acceptedTestCount,
    rejectedTestCount: row.rejectedTestCount,
    runnerVersion: row.runnerVersion,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt ? row.startedAt.toISOString() : null,
    finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
  };
}

export const githubCaseRoutes: FastifyPluginAsync = async (fastify) => {
  const redisConnection = createRedisConnection(
    process.env.REDIS_URL ?? "redis://localhost:56380",
  );
  const caseBuilderQueue: CaseBuilderQueue = createCaseBuilderQueue({
    connection: redisConnection,
  });
  const validationRunnerQueue: ValidationRunnerQueue = createValidationRunnerQueue({
    connection: redisConnection,
  });

  fastify.addHook("onClose", async () => {
    await caseBuilderQueue.close();
    await validationRunnerQueue.close();
    redisConnection.disconnect();
  });

  fastify.post<{ Body: GitHubCaseCreateRequest; Reply: GitHubCase }>(
    "/github/cases",
    {
      schema: {
        body: {
          type: "object",
          required: ["title"],
          additionalProperties: false,
          properties: {
            title: { type: "string", minLength: 1 },
            body: { type: "string" },
            labels: {
              type: "array",
              items: { type: "string", minLength: 1 },
              uniqueItems: true,
            },
            runId: { type: "string", minLength: 1 },
            metadata: { type: "object", additionalProperties: true },
          },
        },
      },
    },
    async (request, reply) => {
      const payload: GitHubCasePayload = {
        kind: githubCasePayloadKind,
        body: request.body.body ?? "",
        metadata: request.body.metadata ?? {},
      };

      if (request.body.runId) {
        payload.runId = request.body.runId;
      }

      const [createdCase] = await fastify.db
        .insert(benchmarkCases)
        .values({
          slug: createSlug(),
          title: request.body.title,
          tags: request.body.labels ?? [],
          metadata: payload,
        })
        .returning();

      if (!createdCase) {
        throw new Error("Failed to create GitHub case");
      }

      reply.code(201);
      return toGitHubCase(createdCase);
    },
  );

  fastify.post<{ Body: GitHubIssueImportRequest; Reply: GitHubIssueImportReply }>(
    "/github/cases/import-issue",
    {
      schema: {
        body: {
          type: "object",
          required: ["issueUrl"],
          additionalProperties: false,
          properties: {
            issueUrl: { type: "string", minLength: 1 },
          },
        },
      },
    },
    async (request, reply) => {
      const parsed = parseGitHubIssueUrl(request.body.issueUrl);

      if (!parsed.ok || !parsed.value) {
        throw createHttpError(`Invalid GitHub issue URL: ${parsed.error ?? "unknown"}`, 400);
      }

      const issueRef = parsed.value;
      const client = createGitHubClient();
      const imported = await importGitHubIssue(client, issueRef, {
        perPage: 100,
        maxPages: 2,
      });

      const warnings: string[] = [];
      const searchQuery = buildPullRequestCandidateSearchQuery(issueRef);
      const searchResult = await searchGitHubPullRequests(client, {
        repository: issueRef,
        query: searchQuery,
        sort: "updated",
        order: "desc",
        perPage: 20,
      }).catch((error: unknown) => {
        warnings.push(error instanceof Error ? error.message : "GitHub PR search failed");
        return undefined;
      });

      const prCandidates = discoverPullRequestCandidates({
        issue: issueRef,
        pullRequests: searchResult?.items ?? [],
        timeline: imported.timeline,
      });

      const importedLabels = labelNames(imported.issue.labels);
      const [issueRow] = await fastify.db
        .insert(githubIssues)
        .values({
          repoOwner: issueRef.owner,
          repoName: issueRef.repo,
          issueNumber: issueRef.issueNumber,
          url: imported.issue.html_url,
          title: imported.issue.title,
          body: imported.issue.body,
          authorLogin: imported.issue.user?.login ?? null,
          state: imported.issue.state,
          labels: toJsonRecordArray(imported.issue.labels),
          comments: toJsonRecordArray(imported.comments),
          timelineEvents: toJsonRecordArray(imported.timeline),
          raw: {
            issue: toJsonRecord(imported.issue),
            events: toJsonRecordArray(imported.events),
          },
          openedAt: toDate(imported.issue.created_at),
          closedAt: toDate(imported.issue.closed_at),
          fetchedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [githubIssues.repoOwner, githubIssues.repoName, githubIssues.issueNumber],
          set: {
            url: imported.issue.html_url,
            title: imported.issue.title,
            body: imported.issue.body,
            authorLogin: imported.issue.user?.login ?? null,
            state: imported.issue.state,
            labels: toJsonRecordArray(imported.issue.labels),
            comments: toJsonRecordArray(imported.comments),
            timelineEvents: toJsonRecordArray(imported.timeline),
            raw: {
              issue: toJsonRecord(imported.issue),
              events: toJsonRecordArray(imported.events),
            },
            openedAt: toDate(imported.issue.created_at),
            closedAt: toDate(imported.issue.closed_at),
            fetchedAt: new Date(),
          },
        })
        .returning();

      if (!issueRow) {
        throw new Error("Failed to import GitHub issue");
      }

      const payload: GitHubCasePayload = {
        kind: githubCasePayloadKind,
        body: imported.issue.body ?? "",
        metadata: {
          source: "github-issue-import",
          issueUrl: imported.issue.html_url,
          issue: {
            repoOwner: issueRef.owner,
            repoName: issueRef.repo,
            issueNumber: issueRef.issueNumber,
            state: imported.issue.state,
            labels: importedLabels,
            commentCount: imported.comments.length,
            eventCount: imported.events.length,
            timelineEventCount: imported.timeline.length,
          },
          prCandidateCount: prCandidates.length,
          warnings,
        },
      };

      const existingCase = await fastify.db.query.benchmarkCases.findFirst({
        where: (cases, { eq: equals }) => equals(cases.githubIssueId, issueRow.id),
      });

      let createdCase: BenchmarkCase;

      if (existingCase) {
        const [updated] = await fastify.db
          .update(benchmarkCases)
          .set({
            title: imported.issue.title,
            tags: [...new Set(["github-import", ...importedLabels])],
            metadata: payload,
            updatedAt: new Date(),
          })
          .where(eq(benchmarkCases.id, existingCase.id))
          .returning();
        if (!updated) {
          throw new Error("Failed to update existing GitHub case");
        }
        createdCase = updated;
      } else {
        const [inserted] = await fastify.db
          .insert(benchmarkCases)
          .values({
            githubIssueId: issueRow.id,
            slug: createIssueCaseSlug(issueRef),
            title: imported.issue.title,
            tags: [...new Set(["github-import", ...importedLabels])],
            metadata: payload,
          })
          .returning();
        if (!inserted) {
          throw new Error("Failed to create imported GitHub case");
        }
        createdCase = inserted;
      }

      reply.code(201);
      return {
        case: toGitHubCase(createdCase),
        issue: {
          id: issueRow.id,
          repoOwner: issueRow.repoOwner,
          repoName: issueRow.repoName,
          issueNumber: issueRow.issueNumber,
          url: issueRow.url,
          title: issueRow.title,
          state: issueRow.state,
          labels: importedLabels,
          commentCount: imported.comments.length,
          timelineEventCount: imported.timeline.length,
        },
        prCandidates,
        needsPrSelection: prCandidates.length === 0,
        warnings,
      };
    },
  );

  fastify.post<{
    Params: { caseId: string };
    Body: GitHubPrSelectionRequest;
    Reply: GitHubPrSelectionReply;
  }>(
    "/github/cases/:caseId/select-pr",
    {
      schema: {
        params: {
          type: "object",
          required: ["caseId"],
          properties: {
            caseId: { type: "string", minLength: 1 },
          },
        },
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            prUrl: { type: "string", minLength: 1 },
            prNumber: { type: "integer", minimum: 1 },
          },
          anyOf: [{ required: ["prUrl"] }, { required: ["prNumber"] }],
        },
      },
    },
    async (request, reply) => {
      const benchmarkCase = await fastify.db.query.benchmarkCases.findFirst({
        where: (cases, { eq: equals }) => equals(cases.id, request.params.caseId),
        with: {
          githubIssue: true,
        },
      });

      if (!benchmarkCase) {
        throw createHttpError("GitHub case not found", 404);
      }

      if (!benchmarkCase.githubIssue) {
        throw createHttpError("Case does not have an imported GitHub issue", 400);
      }

      const pullRequestRef = resolvePullRequestRef({
        body: request.body,
        issue: benchmarkCase.githubIssue,
      });
      const client = createGitHubClient();
      const imported = await importGitHubPullRequestDetail(client, pullRequestRef, {
        perPage: 100,
        maxPages: 3,
      });
      const pullRequest = imported.pullRequest;

      // Fetch the PR diff (test patch) for SWE-bench style validation
      let testPatch: string | null = null;
      try {
        testPatch = await fetchGitHubPullRequestDiff(client, pullRequestRef);
      } catch (diffError) {
        console.warn(`[github-cases] Failed to fetch PR diff for ${pullRequestRef.owner}/${pullRequestRef.repo}#${pullRequestRef.pullNumber}:`,
          diffError instanceof Error ? diffError.message : String(diffError)
        );
      }

      if (
        pullRequest.base.sha.length === 0 ||
        pullRequest.head.sha.length === 0
      ) {
        throw createHttpError("GitHub PR response did not include base/head SHAs", 502);
      }

      const [pullRequestRow] = await fastify.db
        .insert(githubPullRequests)
        .values({
          issueId: benchmarkCase.githubIssue.id,
          repoOwner: pullRequestRef.owner,
          repoName: pullRequestRef.repo,
          prNumber: pullRequestRef.pullNumber,
          url: pullRequest.html_url,
          title: pullRequest.title,
          body: pullRequest.body,
          authorLogin: pullRequest.user?.login ?? null,
          state: pullRequest.state,
          baseRef: pullRequest.base.ref,
          baseSha: pullRequest.base.sha,
          headRef: pullRequest.head.ref,
          headSha: pullRequest.head.sha,
          mergeSha: pullRequest.merge_commit_sha,
          changedFiles: toJsonRecordArray(imported.files),
          raw: {
            pullRequest: toJsonRecord(pullRequest),
          },
          openedAt: toDate(pullRequest.created_at),
          mergedAt: toDate(pullRequest.merged_at),
          fetchedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [githubPullRequests.repoOwner, githubPullRequests.repoName, githubPullRequests.prNumber],
          set: {
            issueId: benchmarkCase.githubIssue.id,
            url: pullRequest.html_url,
            title: pullRequest.title,
            body: pullRequest.body,
            authorLogin: pullRequest.user?.login ?? null,
            state: pullRequest.state,
            baseRef: pullRequest.base.ref,
            baseSha: pullRequest.base.sha,
            headRef: pullRequest.head.ref,
            headSha: pullRequest.head.sha,
            mergeSha: pullRequest.merge_commit_sha,
            changedFiles: toJsonRecordArray(imported.files),
            raw: {
              pullRequest: toJsonRecord(pullRequest),
            },
            openedAt: toDate(pullRequest.created_at),
            mergedAt: toDate(pullRequest.merged_at),
            fetchedAt: new Date(),
          },
        })
        .returning();

      if (!pullRequestRow) {
        throw new Error("Failed to persist selected GitHub PR");
      }

      const nextVersion = await nextCaseVersionNumber(fastify.db, benchmarkCase.id);
      const artifactPrefix = `cases/${benchmarkCase.id}/versions/${nextVersion}`;
      const objectStore = createApiObjectStore();
      await objectStore.ensureBucket();

      const changedFiles = imported.files.map(summarizeChangedFile);
      const [storedIssueArtifact, storedPullRequestArtifact, storedRepositoryArtifact] =
        await Promise.all([
          objectStore.putJsonArtifact({
            key: `${artifactPrefix}/github-issue.json`,
            value: toJsonValue({
              source: "github_issue_import",
              issue: benchmarkCase.githubIssue,
            }),
            metadata: {
              kind: "github_issue",
              caseId: benchmarkCase.id,
            },
          }),
          objectStore.putJsonArtifact({
            key: `${artifactPrefix}/github-pull-request.json`,
            value: toJsonValue({
              source: "github_pull_request_selection",
              pullRequest,
              changedFiles: imported.files,
            }),
            metadata: {
              kind: "github_pull_request",
              caseId: benchmarkCase.id,
              prNumber: String(pullRequestRow.prNumber),
            },
          }),
          objectStore.putJsonArtifact({
            key: `${artifactPrefix}/repository-metadata.json`,
            value: toJsonValue({
              source: "github_pull_request_selection",
              repository: {
                owner: pullRequestRow.repoOwner,
                name: pullRequestRow.repoName,
              },
              base: {
                ref: pullRequestRow.baseRef,
                sha: pullRequestRow.baseSha,
              },
              head: {
                ref: pullRequestRow.headRef,
                sha: pullRequestRow.headSha,
              },
              mergeSha: pullRequestRow.mergeSha,
              changedFiles,
            }),
            metadata: {
              kind: "repository_metadata",
              caseId: benchmarkCase.id,
            },
          }),
        ]);

      // Store test patch if available (for SWE-bench style validation)
      let storedTestPatchArtifact: Awaited<ReturnType<typeof objectStore.putJsonArtifact>> | undefined;
      if (testPatch) {
        storedTestPatchArtifact = await objectStore.putJsonArtifact({
          key: `${artifactPrefix}/test-patch.json`,
          value: toJsonValue({
            source: "github_pull_request_diff",
            testPatch,
            testFiles: imported.files
              .filter((f) => isTestFile(f.filename))
              .map((f) => f.filename),
          }),
          metadata: {
            kind: "test_patch",
            caseId: benchmarkCase.id,
            prNumber: String(pullRequestRow.prNumber),
          },
        });
      }

      const [issueArtifact, pullRequestArtifact, repositoryArtifact] = await Promise.all([
        persistStoredArtifact({
          db: fastify.db,
          kind: "github_issue",
          stored: storedIssueArtifact,
          metadata: {
            caseId: benchmarkCase.id,
            githubIssueId: benchmarkCase.githubIssue.id,
          },
        }),
        persistStoredArtifact({
          db: fastify.db,
          kind: "github_pull_request",
          stored: storedPullRequestArtifact,
          metadata: {
            caseId: benchmarkCase.id,
            githubPullRequestId: pullRequestRow.id,
          },
        }),
        persistStoredArtifact({
          db: fastify.db,
          kind: "repository_metadata",
          stored: storedRepositoryArtifact,
          metadata: {
            caseId: benchmarkCase.id,
            githubPullRequestId: pullRequestRow.id,
          },
        }),
      ]);

      let testPatchArtifact: typeof artifacts.$inferSelect | undefined;
      if (storedTestPatchArtifact) {
        testPatchArtifact = await persistStoredArtifact({
          db: fastify.db,
          kind: "test_patch",
          stored: storedTestPatchArtifact,
          metadata: {
            caseId: benchmarkCase.id,
            githubPullRequestId: pullRequestRow.id,
          },
        });
      }

      const caseVersionMetadata: Record<string, unknown> = {
        source: "github-pr-selection",
        artifactObjectKeys: {
          issue: issueArtifact.objectKey,
          pullRequest: pullRequestArtifact.objectKey,
          repositoryMetadata: repositoryArtifact.objectKey,
        },
        selectedPullRequestId: pullRequestRow.id,
        hasTestPatch: Boolean(testPatchArtifact),
      };

      if (testPatchArtifact) {
        caseVersionMetadata.testPatchArtifactId = testPatchArtifact.id;
        caseVersionMetadata.testPatchObjectKey = testPatchArtifact.objectKey;
      }

      const [caseVersion] = await fastify.db
        .insert(caseVersions)
        .values({
          caseId: benchmarkCase.id,
          version: nextVersion,
          githubIssueId: benchmarkCase.githubIssue.id,
          githubPullRequestId: pullRequestRow.id,
          issueArtifactId: issueArtifact.id,
          pullRequestArtifactId: pullRequestArtifact.id,
          repositoryMetadataArtifactId: repositoryArtifact.id,
          repoOwner: pullRequestRow.repoOwner,
          repoName: pullRequestRow.repoName,
          baseCommitSha: pullRequestRow.baseSha,
          goldCommitSha: pullRequestRow.mergeSha ?? pullRequestRow.headSha,
          metadata: caseVersionMetadata,
        })
        .returning();

      if (!caseVersion) {
        throw new Error("Failed to create case version");
      }

      const caseBuilderJob = await enqueueCaseBuilderPrepareJob(caseBuilderQueue, {
        caseId: benchmarkCase.id,
        caseVersionId: caseVersion.id,
        githubIssueId: benchmarkCase.githubIssue.id,
        githubPullRequestId: pullRequestRow.id,
        artifactIds: {
          issue: issueArtifact.id,
          pullRequest: pullRequestArtifact.id,
          repositoryMetadata: repositoryArtifact.id,
        },
        enqueuedAt: new Date().toISOString(),
      });

      const payload = readPayload(benchmarkCase);
      const selectedPrMetadata = {
        id: pullRequestRow.id,
        repoOwner: pullRequestRow.repoOwner,
        repoName: pullRequestRow.repoName,
        prNumber: pullRequestRow.prNumber,
        url: pullRequestRow.url,
        state: pullRequestRow.state,
        baseRef: pullRequestRow.baseRef,
        baseSha: pullRequestRow.baseSha,
        headRef: pullRequestRow.headRef,
        headSha: pullRequestRow.headSha,
        mergeSha: pullRequestRow.mergeSha,
        changedFileCount: changedFiles.length,
        mergedAt: toIso(pullRequestRow.mergedAt),
      };
      const [updatedCase] = await fastify.db
        .update(benchmarkCases)
        .set({
        metadata: {
          ...payload,
          metadata: {
            ...payload.metadata,
            caseBuilderJob: {
              id: caseBuilderJob.id,
              queueName: caseBuilderJob.queueName,
              state: caseBuilderJob.state,
            },
            selectedPullRequest: selectedPrMetadata,
            latestCaseVersion: {
                id: caseVersion.id,
                version: caseVersion.version,
                status: caseVersion.status,
              },
            },
          },
          updatedAt: new Date(),
        })
        .where(eq(benchmarkCases.id, benchmarkCase.id))
        .returning();

      if (!updatedCase) {
        throw new Error("Failed to update case with selected PR");
      }

      reply.code(200);
      return {
        case: toGitHubCase(updatedCase),
        caseVersion: {
          id: caseVersion.id,
          version: caseVersion.version,
          status: caseVersion.status,
        },
        artifacts: [
          issueArtifact,
          pullRequestArtifact,
          repositoryArtifact,
        ].map(summarizeArtifact),
        caseBuilderJob,
        sweBenchStyleEntry: createSweBenchStyleEntry({
          issue: benchmarkCase.githubIssue,
          pullRequest: pullRequestRow,
          caseVersion,
        }),
        pullRequest: {
          id: pullRequestRow.id,
          repoOwner: pullRequestRow.repoOwner,
          repoName: pullRequestRow.repoName,
          prNumber: pullRequestRow.prNumber,
          url: pullRequestRow.url,
          title: pullRequestRow.title,
          state: pullRequestRow.state,
          baseRef: pullRequestRow.baseRef,
          baseSha: pullRequestRow.baseSha,
          headRef: pullRequestRow.headRef,
          headSha: pullRequestRow.headSha,
          mergeSha: pullRequestRow.mergeSha,
          changedFileCount: changedFiles.length,
          mergedAt: toIso(pullRequestRow.mergedAt),
        },
        changedFiles,
      };
    },
  );

  fastify.get<{
    Params: CaseBuilderJobParams;
    Reply: CaseBuilderJobSummary;
  }>(
    "/case-builder/jobs/:jobId",
    {
      schema: {
        params: {
          type: "object",
          required: ["jobId"],
          properties: {
            jobId: { type: "string", minLength: 1 },
          },
        },
      },
    },
    async (request, reply) => {
      const job = await getCaseBuilderJobSummary(
        caseBuilderQueue,
        request.params.jobId,
      );

      if (!job) {
        throw createHttpError("Case-builder job not found", 404);
      }

      reply.code(200);
      return job;
    },
  );

  fastify.get<{
    Params: ValidationRunnerJobParams;
    Reply: ValidationRunnerJobSummary;
  }>(
    "/validation-runner/jobs/:jobId",
    {
      schema: {
        params: {
          type: "object",
          required: ["jobId"],
          properties: {
            jobId: { type: "string", minLength: 1 },
          },
        },
      },
    },
    async (request, reply) => {
      const job = await getValidationRunnerJobSummary(
        validationRunnerQueue,
        request.params.jobId,
      );

      if (!job) {
        throw createHttpError("Validation-runner job not found", 404);
      }

      reply.code(200);
      return job;
    },
  );

  fastify.get<{ Reply: { caseBuilder: QueueStatus; validationRunner: QueueStatus } }>(
    "/workers/status",
    async (_request, reply) => {
      const [caseBuilder, validationRunner] = await Promise.all([
        getQueueStatus(caseBuilderQueue),
        getQueueStatus(validationRunnerQueue),
      ]);

      reply.code(200);
      return { caseBuilder, validationRunner };
    },
  );

  fastify.get<{ Params: { caseId: string }; Reply: GitHubCase }>(
    "/github/cases/:caseId",
    {
      schema: {
        params: {
          type: "object",
          required: ["caseId"],
          properties: {
            caseId: { type: "string", minLength: 1 },
          },
        },
      },
    },
    async (request, reply) => {
      const githubCase = await fastify.db.query.benchmarkCases.findFirst({
        where: (cases, { eq }) => eq(cases.id, request.params.caseId),
      });

      if (!githubCase) {
        const error = new Error("GitHub case not found") as Error & {
          statusCode: number;
        };
        error.statusCode = 404;
        throw error;
      }

      reply.code(200);
      return toGitHubCase(githubCase);
    },
  );

  fastify.get<{ Reply: GitHubCase[] }>(
    "/github/cases",
    async (_request, reply) => {
      const rows = await fastify.db.query.benchmarkCases.findMany({
        orderBy: (cases, { desc }) => [desc(cases.createdAt)],
        limit: 200,
      });

      reply.code(200);
      return rows.map(toGitHubCase);
    },
  );

  fastify.get<{
    Params: { caseId: string };
    Reply: Array<{ id: string; version: number; status: string; createdAt: string }>;
  }>(
    "/github/cases/:caseId/versions",
    {
      schema: {
        params: {
          type: "object",
          required: ["caseId"],
          properties: {
            caseId: { type: "string", minLength: 1 },
          },
        },
      },
    },
    async (request, reply) => {
      const benchmarkCase = await fastify.db.query.benchmarkCases.findFirst({
        where: (cases, { eq }) => eq(cases.id, request.params.caseId),
      });

      if (!benchmarkCase) {
        throw createHttpError("GitHub case not found", 404);
      }

      const versions = await fastify.db.query.caseVersions.findMany({
        where: (versions, { eq }) => eq(versions.caseId, request.params.caseId),
        orderBy: (versions, { desc }) => [desc(versions.version)],
      });

      reply.code(200);
      return versions.map((v) => ({
        id: v.id,
        version: v.version,
        status: v.status,
        createdAt: v.createdAt.toISOString(),
      }));
    },
  );

  fastify.get<{
    Params: { caseId: string; versionId: string };
    Reply: CaseVersionDetail;
  }>(
    "/github/cases/:caseId/versions/:versionId",
    {
      schema: {
        params: {
          type: "object",
          required: ["caseId", "versionId"],
          properties: {
            caseId: { type: "string", minLength: 1 },
            versionId: { type: "string", minLength: 1 },
          },
        },
      },
    },
    async (request, reply) => {
      const benchmarkCase = await fastify.db.query.benchmarkCases.findFirst({
        where: (cases, { eq }) => eq(cases.id, request.params.caseId),
      });

      if (!benchmarkCase) {
        throw createHttpError("GitHub case not found", 404);
      }

      const version = await fastify.db.query.caseVersions.findFirst({
        where: (versions, { eq, and }) =>
          and(
            eq(versions.id, request.params.versionId),
            eq(versions.caseId, request.params.caseId),
          ),
        with: {
          testSpecs: true,
          validationAttempts: true,
          reproductionSteps: true,
        },
      });

      if (!version) {
        throw createHttpError("Case version not found", 404);
      }

      reply.code(200);
      return {
        id: version.id,
        caseId: version.caseId,
        version: version.version,
        status: version.status,
        repoOwner: version.repoOwner,
        repoName: version.repoName,
        baseCommitSha: version.baseCommitSha,
        goldCommitSha: version.goldCommitSha ?? null,
        testBuilderModelId: version.testBuilderModelId ?? null,
        validationRunnerVersion: version.validationRunnerVersion ?? null,
        createdAt: version.createdAt.toISOString(),
        frozenAt: version.frozenAt ? version.frozenAt.toISOString() : null,
        testSpecs: version.testSpecs.map(toTestSpecSummary),
        validationAttempts: version.validationAttempts.map(toValidationAttemptSummary),
        reproductionSteps: version.reproductionSteps.map(toReproductionStepSummary),
      };
    },
  );

  fastify.post<{ Params: { caseId: string }; Reply: GitHubCase }>(
    "/github/cases/:caseId/freeze",
    {
      schema: {
        params: {
          type: "object",
          required: ["caseId"],
          properties: {
            caseId: { type: "string", minLength: 1 },
          },
        },
      },
    },
    async (request, reply) => {
      const benchmarkCase = await fastify.db.query.benchmarkCases.findFirst({
        where: (cases, { eq }) => eq(cases.id, request.params.caseId),
      });

      if (!benchmarkCase) {
        throw createHttpError("GitHub case not found", 404);
      }

      assertCaseMutable(benchmarkCase);

      const latestVersion = await fastify.db.query.caseVersions.findFirst({
        where: (versions, { eq }) => eq(versions.caseId, benchmarkCase.id),
        orderBy: (versions, { desc }) => [desc(versions.version)],
      });

      if (!latestVersion) {
        throw createHttpError("Case has no versions to freeze", 400);
      }

      if (latestVersion.status === "rejected") {
        throw createHttpError("Latest case version is rejected; cannot freeze", 409);
      }

      const acceptedTests = await fastify.db.query.testSpecs.findMany({
        where: (specs, { eq, and }) =>
          and(
            eq(specs.caseVersionId, latestVersion.id),
            eq(specs.status, "accepted"),
          ),
      });

      if (acceptedTests.length === 0) {
        throw createHttpError(
          "Cannot freeze a case without at least one accepted test spec",
          409,
        );
      }

      const now = new Date();

      await fastify.db
        .update(caseVersions)
        .set({ status: "frozen", frozenAt: now })
        .where(eq(caseVersions.id, latestVersion.id));

      const [updatedCase] = await fastify.db
        .update(benchmarkCases)
        .set({ status: "frozen", frozenAt: now, updatedAt: now })
        .where(eq(benchmarkCases.id, benchmarkCase.id))
        .returning();

      if (!updatedCase) {
        throw new Error("Failed to freeze case");
      }

      reply.code(200);
      return toGitHubCase(updatedCase);
    },
  );

  fastify.post<{ Params: { caseId: string }; Reply: GitHubCase }>(
    "/github/cases/:caseId/reject",
    {
      schema: {
        params: {
          type: "object",
          required: ["caseId"],
          properties: {
            caseId: { type: "string", minLength: 1 },
          },
        },
      },
    },
    async (request, reply) => {
      const benchmarkCase = await fastify.db.query.benchmarkCases.findFirst({
        where: (cases, { eq }) => eq(cases.id, request.params.caseId),
      });

      if (!benchmarkCase) {
        throw createHttpError("GitHub case not found", 404);
      }

      assertCaseMutable(benchmarkCase);

      const latestVersion = await fastify.db.query.caseVersions.findFirst({
        where: (versions, { eq }) => eq(versions.caseId, benchmarkCase.id),
        orderBy: (versions, { desc }) => [desc(versions.version)],
      });

      const now = new Date();

      if (latestVersion) {
        await fastify.db
          .update(caseVersions)
          .set({ status: "rejected", frozenAt: now })
          .where(eq(caseVersions.id, latestVersion.id));
      }

      const [updatedCase] = await fastify.db
        .update(benchmarkCases)
        .set({ status: "rejected", frozenAt: now, updatedAt: now })
        .where(eq(benchmarkCases.id, benchmarkCase.id))
        .returning();

      if (!updatedCase) {
        throw new Error("Failed to reject case");
      }

      reply.code(200);
      return toGitHubCase(updatedCase);
    },
  );

  fastify.get<{
    Params: { caseId: string };
    Reply: {
      caseId: string;
      versions: number;
      results: Array<{
        runId: string;
        caseVersionId: string | null;
        modelId: string | null;
        mode: string;
        status: string;
        chargedCost: number | null;
        computedCost: number | null;
        createdAt: string;
        startedAt: string | null;
        finishedAt: string | null;
        durationMs: number | null;
      }>;
    };
  }>(
    "/github/cases/:caseId/results",
    {
      schema: {
        params: {
          type: "object",
          required: ["caseId"],
          properties: {
            caseId: { type: "string", minLength: 1 },
          },
        },
      },
    },
    async (request, reply) => {
      const benchmarkCase = await fastify.db.query.benchmarkCases.findFirst({
        where: (cases, { eq: equals }) => equals(cases.id, request.params.caseId),
      });

      if (!benchmarkCase) {
        throw createHttpError("GitHub case not found", 404);
      }

      const versions = await fastify.db.query.caseVersions.findMany({
        where: (versionsTable, { eq: equals }) =>
          equals(versionsTable.caseId, request.params.caseId),
        columns: { id: true },
      });

      const versionIds = versions.map((v) => v.id);

      if (versionIds.length === 0) {
        reply.code(200);
        return { caseId: request.params.caseId, versions: 0, results: [] };
      }

      const runRows = await fastify.db.query.runs.findMany({
        where: (r, { inArray }) => inArray(r.caseVersionId, versionIds),
        orderBy: (r, { desc }) => [desc(r.createdAt)],
        limit: 200,
      });

      reply.code(200);
      return {
        caseId: request.params.caseId,
        versions: versions.length,
        results: runRows.map((r) => {
          const startedTs = r.startedAt?.getTime() ?? null;
          const finishedTs = r.finishedAt?.getTime() ?? null;
          const durationMs =
            startedTs != null && finishedTs != null ? finishedTs - startedTs : null;
          return {
            runId: r.id,
            caseVersionId: r.caseVersionId,
            modelId: r.openRouterModelId,
            mode: r.mode,
            status: r.status,
            chargedCost: r.chargedCost != null ? Number(r.chargedCost) : null,
            computedCost: r.computedCost != null ? Number(r.computedCost) : null,
            createdAt: r.createdAt.toISOString(),
            startedAt: r.startedAt?.toISOString() ?? null,
            finishedAt: r.finishedAt?.toISOString() ?? null,
            durationMs,
          };
        }),
      };
    },
  );
};
