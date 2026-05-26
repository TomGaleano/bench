import {
  artifacts,
  caseVersions,
  githubIssues,
  githubPullRequests,
  testSpecs,
  validationAttempts,
} from "@pilab/db";
import type { DbClient } from "@pilab/db";
import {
  createCaseBuilderProgress,
  type CaseBuilderPrepareJobData,
  type CaseBuilderPrepareJobResult,
  type ValidationRunnerJobData,
} from "@pilab/jobs";
import type { JsonValue, StoredArtifact } from "@pilab/object-store";
import { eq, inArray } from "drizzle-orm";
import type {
  ProposedTestBuilderCandidate,
  ProposedTestKind,
  TestBuilderInput,
  TestBuilderRun,
} from "./test-builder-types.js";

type CaseVersionRow = typeof caseVersions.$inferSelect;
type ArtifactRow = typeof artifacts.$inferSelect;
type ValidationAttemptRow = typeof validationAttempts.$inferSelect;
type TestSpecRow = typeof testSpecs.$inferSelect;

export type CaseBuilderPrepareJobLike = {
  data: CaseBuilderPrepareJobData;
  updateProgress(progress: ReturnType<typeof createCaseBuilderProgress>): Promise<void>;
};

export type CaseBuilderObjectStoreLike = {
  getJsonArtifact<T = JsonValue>(key: string): Promise<T>;
  putJsonArtifact(input: {
    key: string;
    value: JsonValue;
    metadata?: Record<string, string>;
  }): Promise<StoredArtifact>;
};

export type CaseBuilderTestBuilder = {
  build(input: TestBuilderInput): Promise<TestBuilderRun>;
};

export type CaseBuilderValidationRunner = {
  enqueue(data: ValidationRunnerJobData): Promise<{ id: string }>;
};

export type CaseBuilderPreflightStore = {
  findCaseVersionById(id: string): Promise<CaseVersionRow | undefined>;
  githubIssueExists(id: string): Promise<boolean>;
  githubPullRequestExists(id: string): Promise<boolean>;
  findArtifactsByIds(ids: string[]): Promise<ArtifactRow[]>;
  createRawJsonArtifact?(input: {
    stored: StoredArtifact;
    metadata: Record<string, unknown>;
  }): Promise<ArtifactRow>;
  createValidationAttempt?(input: {
    caseVersionId: string;
    candidateTestsArtifactId?: string;
    runnerVersion: string;
    rawResults: Record<string, unknown>;
    attemptNumber?: number;
    previousAttemptId?: string;
  }): Promise<ValidationAttemptRow>;
  createProposedTestSpecs?(input: {
    caseVersionId: string;
    validationAttemptId: string;
    tests: ProposedTestSpecRecord[];
    metadata: Record<string, unknown>;
  }): Promise<TestSpecRow[]>;
  markCaseVersionTestBuilder?(input: {
    caseVersionId: string;
    modelId: string;
    metadata: Record<string, unknown>;
  }): Promise<void>;
};

type ProposedTestSpecRecord = {
  name: string;
  kind: ProposedTestKind;
  filePath?: string;
  testCommand: string;
  expectedFailureMode?: string;
  expectedPassMode?: string;
  content?: string;
  rationale: string;
};

type CaseBuilderPersistenceStore = CaseBuilderPreflightStore & Required<
  Pick<
    CaseBuilderPreflightStore,
    | "createRawJsonArtifact"
    | "createValidationAttempt"
    | "createProposedTestSpecs"
    | "markCaseVersionTestBuilder"
  >
>;

export function createDrizzleCaseBuilderPreflightStore(
  db: DbClient,
): CaseBuilderPreflightStore {
  return {
    async findCaseVersionById(id) {
      return db.query.caseVersions.findFirst({
        where: eq(caseVersions.id, id),
      });
    },
    async githubIssueExists(id) {
      const row = await db.query.githubIssues.findFirst({
        where: eq(githubIssues.id, id),
        columns: {
          id: true,
        },
      });
      return row !== undefined;
    },
    async githubPullRequestExists(id) {
      const row = await db.query.githubPullRequests.findFirst({
        where: eq(githubPullRequests.id, id),
        columns: {
          id: true,
        },
      });
      return row !== undefined;
    },
    async findArtifactsByIds(ids) {
      if (ids.length === 0) {
        return [];
      }

      return db.query.artifacts.findMany({
        where: inArray(artifacts.id, ids),
      });
    },
    async createRawJsonArtifact(input) {
      const [artifact] = await db
        .insert(artifacts)
        .values({
          kind: "raw_json",
          storageProvider: "s3",
          bucket: input.stored.bucket,
          objectKey: input.stored.key,
          sha256: input.stored.sha256,
          byteSize: input.stored.sizeBytes,
          contentType: input.stored.contentType,
          metadata: input.metadata,
        })
        .onConflictDoUpdate({
          target: [artifacts.storageProvider, artifacts.bucket, artifacts.objectKey],
          set: {
            sha256: input.stored.sha256,
            byteSize: input.stored.sizeBytes,
            contentType: input.stored.contentType,
            metadata: input.metadata,
          },
        })
        .returning();

      if (!artifact) {
        throw new Error("Failed to create candidate tests artifact");
      }

      return artifact;
    },
    async createValidationAttempt(input) {
      const values: typeof validationAttempts.$inferInsert = {
        caseVersionId: input.caseVersionId,
        runnerVersion: input.runnerVersion,
        rawResults: input.rawResults,
      };
      if (input.candidateTestsArtifactId) {
        values.candidateTestsArtifactId = input.candidateTestsArtifactId;
      }
      if (input.attemptNumber) {
        values.attemptNumber = input.attemptNumber;
      }
      if (input.previousAttemptId) {
        values.previousAttemptId = input.previousAttemptId;
      }

      const [attempt] = await db
        .insert(validationAttempts)
        .values(values)
        .returning();

      if (!attempt) {
        throw new Error("Failed to create validation attempt");
      }

      return attempt;
    },
    async createProposedTestSpecs(input) {
      if (input.tests.length === 0) {
        return [];
      }

      return db
        .insert(testSpecs)
        .values(
          input.tests.map((test) => ({
            caseVersionId: input.caseVersionId,
            validationAttemptId: input.validationAttemptId,
            name: test.name,
            kind: test.kind,
            filePath: test.filePath,
            testCommand: test.testCommand,
            expectedFailureMode: test.expectedFailureMode,
            expectedPassMode: test.expectedPassMode,
            content: test.content,
            metadata: {
              ...input.metadata,
              rationale: test.rationale,
            },
          })),
        )
        .returning();
    },
    async markCaseVersionTestBuilder(input) {
      const caseVersion = await db.query.caseVersions.findFirst({
        where: eq(caseVersions.id, input.caseVersionId),
      });

      if (!caseVersion) {
        throw new Error(`Case version not found: ${input.caseVersionId}`);
      }

      await db
        .update(caseVersions)
        .set({
          testBuilderModelId: input.modelId,
          metadata: {
            ...caseVersion.metadata,
            testBuilder: input.metadata,
          },
        })
        .where(eq(caseVersions.id, input.caseVersionId));
    },
  };
}

export function createCaseBuilderPrepareProcessor(input: {
  store: CaseBuilderPreflightStore;
  objectStore?: CaseBuilderObjectStoreLike;
  testBuilder?: CaseBuilderTestBuilder;
  validationRunner?: CaseBuilderValidationRunner;
}) {
  return async (
    job: CaseBuilderPrepareJobLike,
  ): Promise<CaseBuilderPrepareJobResult> => {
    try {
      await job.updateProgress(
        createCaseBuilderProgress(
          "loading-case-version",
          "Loading case version",
        ),
      );

      const caseVersion = await input.store.findCaseVersionById(
        job.data.caseVersionId,
      );

      if (!caseVersion) {
        throw new Error(`Case version not found: ${job.data.caseVersionId}`);
      }

      assertEqual(
        caseVersion.caseId,
        job.data.caseId,
        `Case version ${caseVersion.id} is not linked to case ${job.data.caseId}`,
      );
      assertEqual(
        caseVersion.githubIssueId,
        job.data.githubIssueId,
        `Case version ${caseVersion.id} is not linked to GitHub issue ${job.data.githubIssueId}`,
      );
      assertEqual(
        caseVersion.githubPullRequestId,
        job.data.githubPullRequestId,
        `Case version ${caseVersion.id} is not linked to GitHub pull request ${job.data.githubPullRequestId}`,
      );
      assertEqual(
        caseVersion.issueArtifactId,
        job.data.artifactIds.issue,
        `Case version ${caseVersion.id} is not linked to issue artifact ${job.data.artifactIds.issue}`,
      );
      assertEqual(
        caseVersion.pullRequestArtifactId,
        job.data.artifactIds.pullRequest,
        `Case version ${caseVersion.id} is not linked to pull request artifact ${job.data.artifactIds.pullRequest}`,
      );
      assertEqual(
        caseVersion.repositoryMetadataArtifactId,
        job.data.artifactIds.repositoryMetadata,
        `Case version ${caseVersion.id} is not linked to repository metadata artifact ${job.data.artifactIds.repositoryMetadata}`,
      );

      await job.updateProgress(
        createCaseBuilderProgress(
          "validating-artifacts",
          "Validating linked issue, pull request, and artifacts",
        ),
      );

      const [githubIssueExists, githubPullRequestExists] = await Promise.all([
        input.store.githubIssueExists(job.data.githubIssueId),
        input.store.githubPullRequestExists(job.data.githubPullRequestId),
      ]);

      if (!githubIssueExists) {
        throw new Error(`GitHub issue not found: ${job.data.githubIssueId}`);
      }

      if (!githubPullRequestExists) {
        throw new Error(
          `GitHub pull request not found: ${job.data.githubPullRequestId}`,
        );
      }

      const artifactIds = uniqueArtifactIds([
        job.data.artifactIds.issue,
        job.data.artifactIds.pullRequest,
        job.data.artifactIds.repositoryMetadata,
      ]);
      const foundArtifacts = await input.store.findArtifactsByIds(artifactIds);
      const foundArtifactIds = new Set(foundArtifacts.map((artifact) => artifact.id));
      const missingArtifactIds = artifactIds.filter(
        (artifactId) => !foundArtifactIds.has(artifactId),
      );

      if (missingArtifactIds.length > 0) {
        throw new Error(`Artifacts not found: ${missingArtifactIds.join(", ")}`);
      }

      await job.updateProgress(
        createCaseBuilderProgress(
          "ready-for-test-builder",
          "Case version preflight complete",
        ),
      );

      {
        if (!input.objectStore || !input.testBuilder) {
          return {
            caseId: job.data.caseId,
            caseVersionId: job.data.caseVersionId,
            stage: "ready-for-test-builder",
            verifiedArtifactCount: foundArtifacts.length,
            completedAt: new Date().toISOString(),
          };
        }

        assertPersistenceStore(input.store);

        await job.updateProgress(
          createCaseBuilderProgress(
            "building-test-candidate",
            "Building proposed tests with Pi coding agent",
          ),
        );

        const artifactById = new Map(foundArtifacts.map((artifact) => [artifact.id, artifact]));
        const issueArtifact = getRequiredArtifact(
          artifactById,
          job.data.artifactIds.issue,
        );
        const pullRequestArtifact = getRequiredArtifact(
          artifactById,
          job.data.artifactIds.pullRequest,
        );
        const repositoryMetadataArtifact = getRequiredArtifact(
          artifactById,
          job.data.artifactIds.repositoryMetadata,
        );

        const testBuilderInput: TestBuilderInput = {
          issueArtifact: await input.objectStore.getJsonArtifact(issueArtifact.objectKey),
          pullRequestArtifact: await input.objectStore.getJsonArtifact(
            pullRequestArtifact.objectKey,
          ),
          repositoryMetadataArtifact: await input.objectStore.getJsonArtifact(
            repositoryMetadataArtifact.objectKey,
          ),
        };

        if (job.data.previousValidationLogArtifactId) {
          try {
            testBuilderInput.previousAttemptLogs = await input.objectStore.getJsonArtifact(
              job.data.previousValidationLogArtifactId,
            );
          } catch {
            console.warn("[case-builder] Could not load previous validation logs");
          }
        }

        const testPatchArtifactId = readOptionalString(caseVersion.metadata, "testPatchArtifactId");
        if (testPatchArtifactId) {
          const testPatchArtifact = artifactById.get(testPatchArtifactId);
          if (testPatchArtifact) {
            console.log(`[case-builder] PR test patch found: ${testPatchArtifact.objectKey}`);
            testBuilderInput.testPatchArtifact = await input.objectStore.getJsonArtifact(
              testPatchArtifact.objectKey,
            );
          }
        }

        const testBuilderRun = await input.testBuilder.build(testBuilderInput);

        await job.updateProgress(
          createCaseBuilderProgress(
            "persisting-proposed-tests",
            "Persisting proposed tests for validation",
          ),
        );

        const candidateTestsArtifact = await persistCandidateTests({
          jobData: job.data,
          caseVersion,
          verifiedArtifactCount: foundArtifacts.length,
          objectStore: input.objectStore,
          store: input.store,
          testBuilderRun,
        });
        const validationAttempt = await input.store.createValidationAttempt({
          caseVersionId: caseVersion.id,
          candidateTestsArtifactId: candidateTestsArtifact.id,
          runnerVersion: "pilab.validation-runner.pending.v1",
          rawResults: {
            source: "case-builder",
            status: "queued",
            proposedTestCount: testBuilderRun.candidate.proposedTests.length,
          },
          attemptNumber: job.data.attemptNumber ?? 1,
          ...(job.data.previousAttemptId
            ? { previousAttemptId: job.data.previousAttemptId }
            : {}),
        });
        const createdTests = await input.store.createProposedTestSpecs({
          caseVersionId: caseVersion.id,
          validationAttemptId: validationAttempt.id,
          tests: testBuilderRun.candidate.proposedTests,
          metadata: {
            source: "pi-test-builder",
            modelId: testBuilderRun.modelId,
            candidateTestsArtifactId: candidateTestsArtifact.id,
            validationAttemptId: validationAttempt.id,
          },
        });
        const validationJob = input.validationRunner
          ? await input.validationRunner.enqueue({
              caseVersionId: caseVersion.id,
              validationAttemptId: validationAttempt.id,
              candidateTestsArtifactId: candidateTestsArtifact.id,
              enqueuedAt: new Date().toISOString(),
            })
          : null;
        const counts = countProposedTests(testBuilderRun.candidate);

        await input.store.markCaseVersionTestBuilder({
          caseVersionId: caseVersion.id,
          modelId: testBuilderRun.modelId,
          metadata: {
            modelId: testBuilderRun.modelId,
            candidateTestsArtifactId: candidateTestsArtifact.id,
            validationAttemptId: validationAttempt.id,
            validationJobId: validationJob?.id ?? null,
            proposedTestCount: createdTests.length,
            failToPassCount: counts.failToPassCount,
            passToPassCount: counts.passToPassCount,
          },
        });

        await job.updateProgress(
          createCaseBuilderProgress(
            "ready-for-validation",
            "Proposed tests are queued for validation",
          ),
        );

        return {
          caseId: job.data.caseId,
          caseVersionId: job.data.caseVersionId,
          stage: "ready-for-validation",
          verifiedArtifactCount: foundArtifacts.length,
          proposedTestCount: createdTests.length,
          failToPassCount: counts.failToPassCount,
          passToPassCount: counts.passToPassCount,
          candidateTestsArtifactId: candidateTestsArtifact.id,
          validationAttemptId: validationAttempt.id,
          ...(validationJob ? { validationJobId: validationJob.id } : {}),
          testBuilderModelId: testBuilderRun.modelId,
          completedAt: new Date().toISOString(),
        };
      }

      // Fell through: no objectStore / testBuilder. Return as preflight-only.
      return {
        caseId: job.data.caseId,
        caseVersionId: job.data.caseVersionId,
        stage: "ready-for-test-builder",
        verifiedArtifactCount: foundArtifacts.length,
        completedAt: new Date().toISOString(),
      };
    } catch (error) {
      await job.updateProgress(
        createCaseBuilderProgress(
          "failed",
          error instanceof Error ? error.message : "Case builder preflight failed",
        ),
      );
      throw error;
    }
  };
}

async function persistCandidateTests(input: {
  jobData: CaseBuilderPrepareJobData;
  caseVersion: CaseVersionRow;
  verifiedArtifactCount: number;
  objectStore: CaseBuilderObjectStoreLike;
  store: CaseBuilderPersistenceStore;
  testBuilderRun: TestBuilderRun;
}): Promise<ArtifactRow> {
  const key = `cases/${input.jobData.caseId}/versions/${input.caseVersion.version}/candidate-tests.json`;
  const stored = await input.objectStore.putJsonArtifact({
    key,
    value: {
      source: "pi-test-builder",
      caseId: input.jobData.caseId,
      caseVersionId: input.jobData.caseVersionId,
      githubIssueId: input.jobData.githubIssueId,
      githubPullRequestId: input.jobData.githubPullRequestId,
      verifiedArtifactCount: input.verifiedArtifactCount,
      modelId: input.testBuilderRun.modelId,
      requestedAt: input.testBuilderRun.requestedAt,
      completedAt: input.testBuilderRun.completedAt,
      attempts: input.testBuilderRun.attempts,
      candidate: input.testBuilderRun.candidate,
      rawResponse: input.testBuilderRun.rawResponse,
    },
    metadata: {
      kind: "candidate_tests",
      caseId: input.jobData.caseId,
      caseVersionId: input.jobData.caseVersionId,
      modelId: input.testBuilderRun.modelId,
    },
  });

  return input.store.createRawJsonArtifact({
    stored,
    metadata: {
      caseId: input.jobData.caseId,
      caseVersionId: input.jobData.caseVersionId,
      source: "pi-test-builder",
      modelId: input.testBuilderRun.modelId,
      attempts: input.testBuilderRun.attempts,
    },
  });
}

function countProposedTests(candidate: ProposedTestBuilderCandidate): {
  failToPassCount: number;
  passToPassCount: number;
} {
  return {
    failToPassCount: candidate.proposedTests.filter((test) => test.kind === "fail_to_pass").length,
    passToPassCount: candidate.proposedTests.filter((test) => test.kind === "pass_to_pass").length,
  };
}

function getRequiredArtifact(
  artifactsById: Map<string, ArtifactRow>,
  artifactId: string,
): ArtifactRow {
  const artifact = artifactsById.get(artifactId);

  if (!artifact) {
    throw new Error(`Artifact not found after preflight: ${artifactId}`);
  }

  return artifact;
}

function assertPersistenceStore(
  store: CaseBuilderPreflightStore,
): asserts store is CaseBuilderPersistenceStore {
  if (
    !store.createRawJsonArtifact ||
    !store.createValidationAttempt ||
    !store.createProposedTestSpecs ||
    !store.markCaseVersionTestBuilder
  ) {
    throw new Error("Case-builder persistence store is not configured");
  }
}

function assertEqual(
  actual: string | null,
  expected: string,
  message: string,
): asserts actual is string {
  if (actual !== expected) {
    throw new Error(message);
  }
}

function uniqueArtifactIds(ids: string[]): string[] {
  return [...new Set(ids)];
}

function readOptionalString(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object" || value === null) return undefined;
  const item = (value as Record<string, unknown>)[key];
  return typeof item === "string" ? item : undefined;
}
