import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { setupEnvironment } from "./setup-environment.js";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  artifacts,
  caseVersions,
  testSpecs,
  validationAttempts,
  type DbClient,
} from "@pilab/db";
import {
  createValidationRunnerProgress,
  type ValidationRunnerJobData,
  type ValidationRunnerJobResult,
  type ValidationLogArtifactSummary,
} from "@pilab/jobs";
import type { JsonValue, StoredArtifact } from "@pilab/object-store";
import { and, eq } from "drizzle-orm";
import {
  cloneRepoAtCommitInRuntime,
  createBenchmarkRuntime,
  shellQuote,
  type RuntimeProvider,
  type RuntimeWorkspace,
} from "@pilab/runtime";

const execFileAsync = promisify(execFile);

type ValidationStatus = typeof validationAttempts.$inferSelect.status;
type TestSpecStatus = typeof testSpecs.$inferSelect.status;
type ArtifactRow = typeof artifacts.$inferSelect;

export type ValidationRunnerAttempt = typeof validationAttempts.$inferSelect;
export type ValidationRunnerCaseVersion = typeof caseVersions.$inferSelect;
export type ValidationRunnerTestSpec = typeof testSpecs.$inferSelect;

type JsonRecord = Record<string, unknown>;

export type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

export type GitCommandExecutor = {
  fetchCommit(input: {
    repoUrl: string;
    commitSha: string;
    destinationPath: string;
    timeoutMs: number;
    image?: string;
  }): Promise<CommandResult[]>;
  runShell(input: {
    command: string;
    cwd: string;
    timeoutMs: number;
  }): Promise<CommandResult>;
  writeFile?(input: {
    cwd: string;
    filePath: string;
    content: string;
    mode?: string;
  }): Promise<void>;
  readFile?(input: {
    cwd: string;
    filePath: string;
  }): Promise<string>;
  fileExists?(input: {
    cwd: string;
    filePath: string;
  }): Promise<boolean>;
  cleanupPath?(path: string): Promise<void>;
};

type ClonedRepository = {
  basePath: string;
  goldPath: string;
  baseCommitSha: string;
  goldCommitSha: string;
  setupIssues: ValidationIssue[];
};

export type ValidationRunnerStore = {
  findAttemptById(id: string): Promise<ValidationRunnerAttempt | undefined>;
  findCaseVersionById(id: string): Promise<ValidationRunnerCaseVersion | undefined>;
  findArtifactById(id: string): Promise<ArtifactRow | undefined>;
  findProposedTestSpecs(validationAttemptId: string): Promise<ValidationRunnerTestSpec[]>;
  markAttemptRunning(input: {
    attemptId: string;
    caseVersionId: string;
    runnerVersion: string;
    rawResults: JsonRecord;
  }): Promise<void>;
  finishAttempt(input: {
    attemptId: string;
    caseVersionId: string;
    status: Exclude<ValidationStatus, "queued" | "running" | "cancelled">;
    acceptedTestIds: string[];
    rejectedTestIds: string[];
    runnerVersion: string;
    rawResults: JsonRecord;
    validationLogArtifactId?: string;
    baseLogArtifactId?: string;
    goldLogArtifactId?: string;
  }): Promise<void>;
  createValidationLogArtifact?(input: {
    stored: StoredArtifact;
    metadata: Record<string, unknown>;
  }): Promise<ArtifactRow>;
};

export type ValidationRunnerObjectStoreLike = {
  ensureBucket(): Promise<void>;
  getJsonArtifact<T = JsonValue>(key: string): Promise<T>;
  putJsonArtifact(input: {
    key: string;
    value: JsonValue;
    metadata?: Record<string, string>;
  }): Promise<StoredArtifact>;
};

export function createDrizzleValidationRunnerStore(
  db: DbClient,
): ValidationRunnerStore {
  return {
    async findAttemptById(id) {
      return db.query.validationAttempts.findFirst({
        where: eq(validationAttempts.id, id),
      });
    },
    async findCaseVersionById(id) {
      return db.query.caseVersions.findFirst({
        where: eq(caseVersions.id, id),
      });
    },
    async findArtifactById(id) {
      return db.query.artifacts.findFirst({
        where: eq(artifacts.id, id),
      });
    },
    async findProposedTestSpecs(validationAttemptId) {
      return db.query.testSpecs.findMany({
        where: and(
          eq(testSpecs.validationAttemptId, validationAttemptId),
          eq(testSpecs.status, "proposed"),
        ),
      });
    },
    async markAttemptRunning(input) {
      const now = new Date();
      await db
        .update(validationAttempts)
        .set({
          status: "running",
          runnerVersion: input.runnerVersion,
          rawResults: input.rawResults,
          startedAt: now,
        })
        .where(eq(validationAttempts.id, input.attemptId));

      const caseVersion = await db.query.caseVersions.findFirst({
        where: eq(caseVersions.id, input.caseVersionId),
      });

      await db
        .update(caseVersions)
        .set({
          status: "validating",
          validationRunnerVersion: input.runnerVersion,
          metadata: {
            ...(caseVersion?.metadata ?? {}),
            validationRunner: {
              runnerVersion: input.runnerVersion,
              validationAttemptId: input.attemptId,
              startedAt: now.toISOString(),
            },
          },
        })
        .where(eq(caseVersions.id, input.caseVersionId));
    },
    async finishAttempt(input) {
      const now = new Date();
      await Promise.all([
        ...input.acceptedTestIds.map((id) =>
          setTestSpecStatus(db, id, "accepted"),
        ),
        ...input.rejectedTestIds.map((id) =>
          setTestSpecStatus(db, id, "rejected"),
        ),
      ]);

      await db
        .update(validationAttempts)
        .set({
          status: input.status,
          acceptedTestCount: input.acceptedTestIds.length,
          rejectedTestCount: input.rejectedTestIds.length,
          runnerVersion: input.runnerVersion,
          rawResults: input.rawResults,
          baseLogArtifactId: input.baseLogArtifactId,
          goldLogArtifactId: input.goldLogArtifactId,
          finishedAt: now,
        })
        .where(eq(validationAttempts.id, input.attemptId));

      const caseVersion = await db.query.caseVersions.findFirst({
        where: eq(caseVersions.id, input.caseVersionId),
      });

      await db
        .update(caseVersions)
        .set({
          // Don't set "rejected" here — handleValidationCompletion decides the
          // final status once all retry attempts are exhausted. Keep "validating"
          // so the UI doesn't prematurely show rejection while retries are pending.
          status: input.status === "accepted" ? "candidate" : "validating",
          validationLogArtifactId: input.validationLogArtifactId,
          validationRunnerVersion: input.runnerVersion,
          metadata: {
            ...(caseVersion?.metadata ?? {}),
            validationRunner: {
              runnerVersion: input.runnerVersion,
              validationAttemptId: input.attemptId,
              status: input.status,
              acceptedTestCount: input.acceptedTestIds.length,
              rejectedTestCount: input.rejectedTestIds.length,
              validationLogArtifactId: input.validationLogArtifactId ?? null,
              baseLogArtifactId: input.baseLogArtifactId ?? null,
              goldLogArtifactId: input.goldLogArtifactId ?? null,
              finishedAt: now.toISOString(),
            },
          },
        })
        .where(eq(caseVersions.id, input.caseVersionId));
    },
    async createValidationLogArtifact(input) {
      const [artifact] = await db
        .insert(artifacts)
        .values({
          kind: "validation_log",
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
        throw new Error("Failed to create validation log artifact");
      }

      return artifact;
    },
  };
}

export function createValidationRunnerProcessor(input: {
  store: ValidationRunnerStore;
  objectStore?: ValidationRunnerObjectStoreLike;
  executor?: GitCommandExecutor;
  runtime?: RuntimeProvider;
  runnerVersion?: string;
  commandTimeoutMs?: number;
}) {
  const baseExecutor = input.executor ?? createRuntimeGitCommandExecutor(input.runtime ?? createBenchmarkRuntime());
  const runnerVersion = input.runnerVersion ?? "pilab.validation-runner.v1";
  const commandTimeoutMs = input.commandTimeoutMs ?? 300_000;

  return async (job: {
    data: ValidationRunnerJobData;
    updateProgress(
      progress: ReturnType<typeof createValidationRunnerProgress>,
    ): Promise<void>;
  }): Promise<ValidationRunnerJobResult> => {
    const startedAt = new Date().toISOString();
    try {
      await job.updateProgress(
        createValidationRunnerProgress(
          "loading-validation-attempt",
          "Loading validation attempt",
        ),
      );

      const attempt = await input.store.findAttemptById(
        job.data.validationAttemptId,
      );
      if (!attempt) {
        throw new Error(`Validation attempt not found: ${job.data.validationAttemptId}`);
      }

      const caseVersion = await input.store.findCaseVersionById(
        job.data.caseVersionId,
      );
      if (!caseVersion) {
        throw new Error(`Case version not found: ${job.data.caseVersionId}`);
      }

      const executor = baseExecutor;
      if (!input.executor) {
        await job.updateProgress(
          createValidationRunnerProgress(
            "docker-setup",
            "Configuring Daytona sandbox runtime",
          ),
        );
      }

      if (attempt.caseVersionId !== job.data.caseVersionId) {
        throw new Error(
          `Validation attempt ${attempt.id} is not linked to case version ${job.data.caseVersionId}`,
        );
      }

      if (attempt.candidateTestsArtifactId !== job.data.candidateTestsArtifactId) {
        throw new Error(
          `Validation attempt ${attempt.id} is not linked to candidate artifact ${job.data.candidateTestsArtifactId}`,
        );
      }

      await input.store.markAttemptRunning({
        attemptId: attempt.id,
        caseVersionId: caseVersion.id,
        runnerVersion,
        rawResults: {
          source: "validation-runner",
          status: "running",
          runnerVersion,
          startedAt,
        },
      });

      await job.updateProgress(
        createValidationRunnerProgress(
          "validating-inputs",
          "Validating proposed test inputs",
        ),
      );

      const [candidateArtifact, proposedTests] = await Promise.all([
        input.store.findArtifactById(job.data.candidateTestsArtifactId),
        input.store.findProposedTestSpecs(attempt.id),
      ]);

      let candidateArtifactContent: JsonValue | null = null;
      if (input.objectStore && candidateArtifact) {
        try {
          candidateArtifactContent = await input.objectStore.getJsonArtifact(
            candidateArtifact.objectKey,
          );
        } catch {
          // ignore missing artifact content
        }
      }

      const candidateHasBehavioralReproduction =
        isRecord(candidateArtifactContent) &&
        isRecord(candidateArtifactContent.candidate) &&
        isRecord(candidateArtifactContent.candidate.behavioralReproduction);

      const inputIssues = validateAttemptInputs({
        candidateArtifact,
        proposedTests,
        caseVersion,
        candidateHasBehavioralReproduction,
        hasGrader: false,
      });

      await job.updateProgress(
        createValidationRunnerProgress(
          "checking-repository-refs",
          "Checking repository base and gold commits",
        ),
      );

      const repository = await checkRepositoryRefs({
        executor,
        repoOwner: caseVersion.repoOwner,
        repoName: caseVersion.repoName,
        baseCommitSha: caseVersion.baseCommitSha,
        goldCommitSha: caseVersion.goldCommitSha,
        timeoutMs: commandTimeoutMs,
      });

      let testPatchResults: TestPatchValidationResult | null = null;
      let behavioralResults: BehavioralReproductionResult | null = null;
      let testResults: TestValidationResult[] = [];

      const testPatchArtifactId = readOptionalString(caseVersion.metadata, "testPatchArtifactId");
      if (testPatchArtifactId) {
        await job.updateProgress(
          createValidationRunnerProgress(
            "validating-test-patch",
            "Validating PR test patch",
          ),
        );
        testPatchResults = await validateTestPatch({
          caseVersion,
          testPatchArtifactId,
          store: input.store,
          objectStore: input.objectStore,
          executor,
          commandTimeoutMs,
        });
      }

      if (proposedTests.length > 0) {
        await job.updateProgress(
          createValidationRunnerProgress(
            "validating-tests",
            "Validating proposed tests",
          ),
        );
        testResults = await validateProposedTests({
          caseVersion,
          proposedTests,
          executor,
          commandTimeoutMs,
          repositoryReady: repository.ready,
          updateProgress: (p) =>
            job.updateProgress(
              createValidationRunnerProgress(
                p.stage as Parameters<typeof createValidationRunnerProgress>[0],
                p.message,
              ),
            ),
        });
      }

      const acceptedTestIds = testResults
        .filter((result) => result.status === "accepted")
        .map((result) => result.testSpecId);
      const rejectedTestIds = testResults
        .filter((result) => result.status === "rejected")
        .map((result) => result.testSpecId);

      const hasValidationErrors =
        inputIssues.some((issue) => issue.severity === "error") ||
        (testPatchResults?.issues.some((i) => i.severity === "error") ?? false);

      let status: Exclude<ValidationStatus, "queued" | "running" | "cancelled"> = "rejected";

      if (!hasValidationErrors) {
        if (testPatchResults && testPatchResults.failToPassTests.length > 0) {
          status = "accepted";
        } else if (testResults.length > 0) {
          status = rejectedTestIds.length === 0 ? "accepted" : "rejected";
        } else {
          // No valid tests and no agent-proposed tests either. Reject so the
          // outer retry loop can either try again or lock the case to
          // llm_evaluator_only after the attempt cap.
          status = "rejected";
        }
      }

      await job.updateProgress(
        createValidationRunnerProgress(
          "persisting-results",
          "Persisting validation results",
        ),
      );

      const completedAt = new Date().toISOString();
      const rawResults = {
        source: "validation-runner",
        status,
        runnerVersion,
        startedAt,
        completedAt,
        repository,
        inputIssues,
        testPatchResults: testPatchResults
          ? {
              failToPassTests: testPatchResults.failToPassTests,
              passToPassTests: testPatchResults.passToPassTests,
              failToFailTests: testPatchResults.failToFailTests,
            }
          : null,
        tests: testResults,
      };
      const logArtifacts = await persistValidationLogs({
        objectStore: input.objectStore,
        store: input.store,
        caseVersion,
        attempt,
        runnerVersion,
        rawResults,
        testResults,
        testPatchResults,
        behavioralResults,
      });

      const finishInput: Parameters<ValidationRunnerStore["finishAttempt"]>[0] = {
        attemptId: attempt.id,
        caseVersionId: caseVersion.id,
        status,
        acceptedTestIds,
        rejectedTestIds,
        runnerVersion,
        rawResults: {
          ...rawResults,
          artifacts: logArtifacts,
        },
      };

      if (logArtifacts.validationLogArtifact) {
        finishInput.validationLogArtifactId = logArtifacts.validationLogArtifact.id;
      }

      if (logArtifacts.baseLogArtifact) {
        finishInput.baseLogArtifactId = logArtifacts.baseLogArtifact.id;
      }

      if (logArtifacts.goldLogArtifact) {
        finishInput.goldLogArtifactId = logArtifacts.goldLogArtifact.id;
      }

      await input.store.finishAttempt(finishInput);

      await job.updateProgress(
        createValidationRunnerProgress(
          status,
          status === "accepted"
            ? "Validation accepted proposed tests"
            : "Validation rejected proposed tests",
        ),
      );

      const result: ValidationRunnerJobResult = {
        caseVersionId: caseVersion.id,
        validationAttemptId: attempt.id,
        status,
        acceptedTestCount: acceptedTestIds.length,
        rejectedTestCount: rejectedTestIds.length,
        ...toValidationRunnerArtifactResult(logArtifacts),
        completedAt,
        rejectedTests: testResults
          .filter((result) => result.status === "rejected")
          .map((result) => ({
            testSpecId: result.testSpecId,
            name: result.name,
            kind: result.kind,
            issues: result.issues.map((issue) => ({
              severity: issue.severity,
              code: issue.code,
              message: issue.message,
            })),
          })),
      };

      if (testPatchResults) {
        result.failToPassTests = testPatchResults.failToPassTests;
        result.passToPassTests = testPatchResults.passToPassTests;
      }

      return result;
    } catch (error) {
      const completedAt = new Date().toISOString();
      await job.updateProgress(
        createValidationRunnerProgress(
          "error",
          error instanceof Error ? error.message : "Validation runner failed",
        ),
      );

      await markErrorIfPossible({
        store: input.store,
        data: job.data,
        runnerVersion,
        startedAt,
        completedAt,
        error,
      });

      throw error;
    }
  };
}

async function setTestSpecStatus(
  db: DbClient,
  id: string,
  status: TestSpecStatus,
): Promise<void> {
  await db
    .update(testSpecs)
    .set({ status })
    .where(eq(testSpecs.id, id));
}

async function persistValidationLogs(input: {
  objectStore: ValidationRunnerObjectStoreLike | undefined;
  store: ValidationRunnerStore;
  caseVersion: ValidationRunnerCaseVersion;
  attempt: ValidationRunnerAttempt;
  runnerVersion: string;
  rawResults: JsonRecord;
  testResults: TestValidationResult[];
  testPatchResults: TestPatchValidationResult | null;
  behavioralResults: BehavioralReproductionResult | null;
}): Promise<{
  validationLogArtifact?: ValidationLogArtifactSummary;
  baseLogArtifact?: ValidationLogArtifactSummary;
  goldLogArtifact?: ValidationLogArtifactSummary;
}> {
  if (!input.objectStore || !input.store.createValidationLogArtifact) {
    return {};
  }

  await input.objectStore.ensureBucket();
  const store = input.store as ValidationRunnerStore &
    Required<Pick<ValidationRunnerStore, "createValidationLogArtifact">>;

  const prefix = `cases/${input.caseVersion.caseId}/versions/${input.caseVersion.version}/validation/${input.attempt.id}`;
  const metadata = {
    caseId: input.caseVersion.caseId,
    caseVersionId: input.caseVersion.id,
    validationAttemptId: input.attempt.id,
    runnerVersion: input.runnerVersion,
  };
  const [validationLog, baseLog, goldLog] = await Promise.all([
    persistOneValidationLog({
      objectStore: input.objectStore,
      store,
      key: `${prefix}/validation-log.json`,
      value: {
        ...input.rawResults,
        logKind: "validation",
      },
      metadata: {
        ...metadata,
        logKind: "validation",
      },
    }),
    persistOneValidationLog({
      objectStore: input.objectStore,
      store,
      key: `${prefix}/base-log.json`,
      value: {
        source: "validation-runner",
        logKind: "base",
        caseVersionId: input.caseVersion.id,
        validationAttemptId: input.attempt.id,
        tests: input.testResults.map((result) => ({
          testSpecId: result.testSpecId,
          name: result.name,
          kind: result.kind,
          status: result.status,
          base: result.base ?? null,
        })),
        testPatch: input.testPatchResults
          ? {
              failToPassTests: input.testPatchResults.failToPassTests,
              passToPassTests: input.testPatchResults.passToPassTests,
              failToFailTests: input.testPatchResults.failToFailTests,
              baseResults: sanitizeCommandResult(input.testPatchResults.baseResults),
              goldResults: sanitizeCommandResult(input.testPatchResults.goldResults),
            }
          : undefined,
        behavioralReproduction: input.behavioralResults
          ? { reproducedOnBase: input.behavioralResults.reproducedOnBase }
          : undefined,
      },
      metadata: {
        ...metadata,
        logKind: "base",
      },
    }),
    persistOneValidationLog({
      objectStore: input.objectStore,
      store,
      key: `${prefix}/gold-log.json`,
      value: {
        source: "validation-runner",
        logKind: "gold",
        caseVersionId: input.caseVersion.id,
        validationAttemptId: input.attempt.id,
        tests: input.testResults.map((result) => ({
          testSpecId: result.testSpecId,
          name: result.name,
          kind: result.kind,
          status: result.status,
          gold: result.gold ?? null,
        })),
        testPatch: input.testPatchResults
          ? {
              failToPassTests: input.testPatchResults.failToPassTests,
              passToPassTests: input.testPatchResults.passToPassTests,
              failToFailTests: input.testPatchResults.failToFailTests,
              baseResults: sanitizeCommandResult(input.testPatchResults.baseResults),
              goldResults: sanitizeCommandResult(input.testPatchResults.goldResults),
            }
          : undefined,
        behavioralReproduction: input.behavioralResults
          ? { fixedOnGold: input.behavioralResults.fixedOnGold }
          : undefined,
      },
      metadata: {
        ...metadata,
        logKind: "gold",
      },
    }),
  ]);

  return {
    validationLogArtifact: summarizeValidationLogArtifact(validationLog),
    baseLogArtifact: summarizeValidationLogArtifact(baseLog),
    goldLogArtifact: summarizeValidationLogArtifact(goldLog),
  };
}

function toValidationRunnerArtifactResult(input: {
  validationLogArtifact?: ValidationLogArtifactSummary;
  baseLogArtifact?: ValidationLogArtifactSummary;
  goldLogArtifact?: ValidationLogArtifactSummary;
}) {
  const result: {
    validationLogArtifact?: ValidationLogArtifactSummary;
    baseLogArtifact?: ValidationLogArtifactSummary;
    goldLogArtifact?: ValidationLogArtifactSummary;
  } = {};

  if (input.validationLogArtifact) {
    result.validationLogArtifact = input.validationLogArtifact;
  }

  if (input.baseLogArtifact) {
    result.baseLogArtifact = input.baseLogArtifact;
  }

  if (input.goldLogArtifact) {
    result.goldLogArtifact = input.goldLogArtifact;
  }

  return result;
}

function summarizeValidationLogArtifact(
  artifact: ArtifactRow,
): ValidationLogArtifactSummary {
  return {
    id: artifact.id,
    kind: "validation_log",
    objectKey: artifact.objectKey,
    byteSize: artifact.byteSize ?? 0,
    contentType: artifact.contentType ?? "application/json",
  };
}

async function persistOneValidationLog(input: {
  objectStore: ValidationRunnerObjectStoreLike;
  store: ValidationRunnerStore & Required<Pick<ValidationRunnerStore, "createValidationLogArtifact">>;
  key: string;
  value: unknown;
  metadata: Record<string, string>;
}): Promise<ArtifactRow> {
  const stored = await input.objectStore.putJsonArtifact({
    key: input.key,
    value: toJsonValue(input.value),
    metadata: input.metadata,
  });

  return input.store.createValidationLogArtifact({
    stored,
    metadata: input.metadata,
  });
}

function toJsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function validateAttemptInputs(input: {
  candidateArtifact: ArtifactRow | undefined;
  proposedTests: ValidationRunnerTestSpec[];
  caseVersion: ValidationRunnerCaseVersion;
  candidateHasBehavioralReproduction: boolean;
  hasGrader?: boolean;
}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!input.candidateArtifact) {
    issues.push({
      severity: "error",
      code: "candidate_artifact_missing",
      message: "Candidate tests artifact is missing.",
    });
  }

  const hasTestPatch = Boolean(readOptionalString(input.caseVersion.metadata, "testPatchArtifactId"));
  if (
    input.proposedTests.length === 0 &&
    !hasTestPatch &&
    !input.candidateHasBehavioralReproduction &&
    !input.hasGrader
  ) {
    issues.push({
      severity: "error",
      code: "no_proposed_tests",
      message: "No proposed test specs are linked to the validation attempt.",
    });
  }

  if (!isCommitSha(input.caseVersion.baseCommitSha)) {
    issues.push({
      severity: "error",
      code: "invalid_base_commit",
      message: "Case version base commit is not a full SHA.",
    });
  }

  if (!input.caseVersion.goldCommitSha || !isCommitSha(input.caseVersion.goldCommitSha)) {
    issues.push({
      severity: "error",
      code: "invalid_gold_commit",
      message: "Case version gold commit is missing or not a full SHA.",
    });
  }

  return issues;
}

async function checkRepositoryRefs(input: {
  executor: GitCommandExecutor;
  repoOwner: string;
  repoName: string;
  baseCommitSha: string;
  goldCommitSha: string | null;
  timeoutMs: number;
}): Promise<RepositoryCheckResult> {
  const repoUrl = `https://github.com/${input.repoOwner}/${input.repoName}.git`;

  if (!input.goldCommitSha) {
    return {
      repoUrl,
      ready: false,
      checks: [],
      issues: [
        {
          severity: "error",
          code: "gold_commit_missing",
          message: "Cannot validate without a gold commit.",
        },
      ],
    };
  }

  const image = selectImageForRepo(input.repoOwner, input.repoName);
  const tempRoot = await mkdtemp(path.join(tmpdir(), "pilab-validation-"));
  const basePath = path.join(tempRoot, "base");
  const goldPath = path.join(tempRoot, "gold");
  try {
    const [baseResults, goldResults] = await Promise.all([
      input.executor.fetchCommit({
        repoUrl,
        commitSha: input.baseCommitSha,
        destinationPath: basePath,
        timeoutMs: input.timeoutMs,
        image,
      }),
      input.executor.fetchCommit({
        repoUrl,
        commitSha: input.goldCommitSha,
        destinationPath: goldPath,
        timeoutMs: input.timeoutMs,
        image,
      }),
    ]);

    const checks = [
      summarizeFetch("base", input.baseCommitSha, baseResults),
      summarizeFetch("gold", input.goldCommitSha, goldResults),
    ];
    const issues = checks
      .filter((check) => !check.ok)
      .map((check): ValidationIssue => ({
        severity: "error",
        code: `${check.label}_commit_unavailable`,
        message: `Could not fetch ${check.label} commit ${check.commitSha}.`,
      }));

    return {
      repoUrl,
      ready: issues.length === 0,
      checks,
      issues,
    };
  } finally {
    await input.executor.cleanupPath?.(basePath).catch(() => {});
    await input.executor.cleanupPath?.(goldPath).catch(() => {});
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function validateTestPatch(input: {
  caseVersion: ValidationRunnerCaseVersion;
  testPatchArtifactId: string;
  store: ValidationRunnerStore;
  objectStore: ValidationRunnerObjectStoreLike | undefined;
  executor: GitCommandExecutor;
  commandTimeoutMs: number;
}): Promise<TestPatchValidationResult> {
  const artifactRow = await input.store.findArtifactById(input.testPatchArtifactId);
  if (!artifactRow) {
    return {
      failToPassTests: [],
      passToPassTests: [],
      failToFailTests: [],
      baseResults: { exitCode: 1, stdout: "", stderr: "", timedOut: false },
      goldResults: { exitCode: 1, stdout: "", stderr: "", timedOut: false },
      issues: [{
        severity: "error",
        code: "test_patch_artifact_missing",
        message: `Test patch artifact not found: ${input.testPatchArtifactId}`,
      }],
    };
  }

  if (!input.objectStore) {
    return {
      failToPassTests: [],
      passToPassTests: [],
      failToFailTests: [],
      baseResults: { exitCode: 1, stdout: "", stderr: "", timedOut: false },
      goldResults: { exitCode: 1, stdout: "", stderr: "", timedOut: false },
      issues: [{
        severity: "error",
        code: "object_store_missing",
        message: "Object store is required to load test patch artifact.",
      }],
    };
  }

  let artifact: unknown;
  try {
    artifact = await input.objectStore.getJsonArtifact(artifactRow.objectKey);
  } catch (error) {
    return {
      failToPassTests: [],
      passToPassTests: [],
      failToFailTests: [],
      baseResults: { exitCode: 1, stdout: "", stderr: "", timedOut: false },
      goldResults: { exitCode: 1, stdout: "", stderr: "", timedOut: false },
      issues: [{
        severity: "error",
        code: "test_patch_artifact_load_failed",
        message: error instanceof Error ? error.message : "Failed to load test patch artifact",
      }],
    };
  }

  const testPatch = readOptionalString(artifact, "testPatch");
  const testFiles = readArray(artifact, "testFiles").filter((f): f is string => typeof f === "string");

  if (!testPatch || testFiles.length === 0) {
    return {
      failToPassTests: [],
      passToPassTests: [],
      failToFailTests: [],
      baseResults: { exitCode: 1, stdout: "", stderr: "", timedOut: false },
      goldResults: { exitCode: 1, stdout: "", stderr: "", timedOut: false },
      issues: [{
        severity: "error",
        code: "test_patch_invalid",
        message: "Test patch artifact is missing testPatch or testFiles.",
      }],
    };
  }

  const cloned = await cloneAndSetupRepository({
    caseVersion: input.caseVersion,
    executor: input.executor,
    commandTimeoutMs: input.commandTimeoutMs,
  });

  if (cloned.setupIssues.length > 0) {
    return {
      failToPassTests: [],
      passToPassTests: [],
      failToFailTests: [],
      baseResults: { exitCode: 1, stdout: "", stderr: "", timedOut: false },
      goldResults: { exitCode: 1, stdout: "", stderr: "", timedOut: false },
      issues: cloned.setupIssues,
    };
  }

  try {
    const patchPath = path.join(cloned.basePath, ".pilab-test-patch.diff");
    await writeRuntimeFile(input.executor, cloned.basePath, ".pilab-test-patch.diff", testPatch);

    const checkResult = await input.executor.runShell({
      command: `git apply --check "${patchPath}"`,
      cwd: cloned.basePath,
      timeoutMs: input.commandTimeoutMs,
    });

    if (checkResult.exitCode !== 0) {
      return {
        failToPassTests: [],
        passToPassTests: [],
        failToFailTests: [],
        baseResults: sanitizeCommandResult(checkResult),
        goldResults: { exitCode: 1, stdout: "", stderr: "", timedOut: false },
        issues: [{
          severity: "error",
          code: "test_patch_apply_check_failed",
          message: `Patch does not apply cleanly: ${checkResult.stderr}`,
        }],
      };
    }

    const applyResult = await input.executor.runShell({
      command: `git apply "${patchPath}"`,
      cwd: cloned.basePath,
      timeoutMs: input.commandTimeoutMs,
    });

    if (applyResult.exitCode !== 0) {
      return {
        failToPassTests: [],
        passToPassTests: [],
        failToFailTests: [],
        baseResults: sanitizeCommandResult(applyResult),
        goldResults: { exitCode: 1, stdout: "", stderr: "", timedOut: false },
        issues: [{
          severity: "error",
          code: "test_patch_apply_failed",
          message: `Failed to apply patch: ${applyResult.stderr}`,
        }],
      };
    }

    const command = await buildTestPatchCommand(
      testFiles,
      input.caseVersion.testCommands,
      cloned.basePath,
      input.executor.readFile
        ? (filePath) => input.executor.readFile!({
            cwd: cloned.basePath,
            filePath: path.relative(cloned.basePath, filePath),
          })
        : undefined,
    );

    const [baseResult, goldResult] = await Promise.all([
      input.executor.runShell({ command, cwd: cloned.basePath, timeoutMs: input.commandTimeoutMs }),
      input.executor.runShell({ command, cwd: cloned.goldPath, timeoutMs: input.commandTimeoutMs }),
    ]);

    const baseParsed = parseTestOutput(`${baseResult.stdout}\n${baseResult.stderr}`, testFiles);
    const goldParsed = parseTestOutput(`${goldResult.stdout}\n${goldResult.stderr}`, testFiles);

    const baseMap = new Map(baseParsed.map((t) => [t.testName, t.passed]));
    const goldMap = new Map(goldParsed.map((t) => [t.testName, t.passed]));

    const allTests = new Set([...baseMap.keys(), ...goldMap.keys()]);
    const failToPass: string[] = [];
    const passToPass: string[] = [];
    const failToFail: string[] = [];

    for (const testName of allTests) {
      const basePassed = baseMap.get(testName) ?? false;
      const goldPassed = goldMap.get(testName) ?? false;
      if (!basePassed && goldPassed) failToPass.push(testName);
      else if (basePassed && goldPassed) passToPass.push(testName);
      else if (!basePassed && !goldPassed) failToFail.push(testName);
    }

    return {
      failToPassTests: failToPass,
      passToPassTests: passToPass,
      failToFailTests: failToFail,
      baseResults: sanitizeCommandResult(baseResult),
      goldResults: sanitizeCommandResult(goldResult),
      issues: [],
    };
  } finally {
    await cleanupClonedRepository(input.executor, cloned);
  }
}

export async function buildTestPatchCommand(
  testFiles: string[],
  testCommands: string[],
  repoPath: string,
  readPackageJson?: (path: string) => Promise<string>,
): Promise<string> {
  if (testCommands.length > 0) {
    const base = testCommands[0]!.trim();
    if (
      base.startsWith("pytest") ||
      base.startsWith("jest") ||
      base.startsWith("vitest") ||
      base.startsWith("cargo test") ||
      base.startsWith("go test")
    ) {
      return `${base} ${testFiles.join(" ")}`;
    }
    return base;
  }
  if (testFiles.some((f) => f.endsWith(".py"))) {
    return `pytest -v ${testFiles.join(" ")}`;
  }

  const detected = await detectTestRunner(repoPath, readPackageJson);
  if (detected) {
    return `${detected.command} ${testFiles.join(" ")}`;
  }

  return `npx jest --verbose ${testFiles.join(" ")}`;
}

export async function detectTestRunner(
  repoPath: string,
  readPackageJson?: (path: string) => Promise<string>,
): Promise<{ name: string; command: string } | null> {
  try {
    const pkgJsonPath = path.join(repoPath, "package.json");
    let content: string;
    if (readPackageJson) {
      content = await readPackageJson(pkgJsonPath);
    } else {
      const { readFile, stat } = await import("node:fs/promises");
      await stat(pkgJsonPath);
      content = await readFile(pkgJsonPath, "utf8");
    }
    const pkg = JSON.parse(content) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      scripts?: Record<string, string>;
    };
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };

    if (deps?.vitest) return { name: "vitest", command: "npx vitest run" };
    if (deps?.jest) return { name: "jest", command: "npx jest" };
    if (deps?.mocha) return { name: "mocha", command: "npx mocha" };
    if (deps?.ava) return { name: "ava", command: "npx ava" };
    if (deps?.jasmine) return { name: "jasmine", command: "npx jasmine" };
    if (deps?.tap) return { name: "tap", command: "npx tap" };

    if (pkg.scripts?.test) {
      const script = pkg.scripts.test;
      if (script.includes("vitest")) return { name: "vitest", command: "npx vitest run" };
      if (script.includes("jest")) return { name: "jest", command: "npx jest" };
      if (script.includes("mocha")) return { name: "mocha", command: "npx mocha" };
    }
  } catch {
    // ignore
  }

  return null;
}

type ParsedTestResult = {
  testName: string;
  passed: boolean;
};

function parseTestOutput(output: string, _testFiles: string[]): ParsedTestResult[] {
  const pytest = parsePytestOutput(output);
  if (pytest.length > 0) return pytest;
  const jest = parseJestOutput(output);
  if (jest.length > 0) return jest;
  const vitest = parseVitestOutput(output);
  if (vitest.length > 0) return vitest;
  return [];
}

function parsePytestOutput(output: string): ParsedTestResult[] {
  const results: ParsedTestResult[] = [];
  const regex = /^\s*(.*?)\s+(PASSED|FAILED|ERROR|SKIPPED)\s*$/gm;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(output)) !== null) {
    const testName = match[1]!.trim();
    const status = match[2]!.trim();
    if (testName && status) {
      results.push({ testName, passed: status === "PASSED" });
    }
  }
  return results;
}

function parseJestOutput(output: string): ParsedTestResult[] {
  const results: ParsedTestResult[] = [];
  const lines = output.split("\n");
  let currentFile = "";
  for (const line of lines) {
    const passMatch = line.match(/^PASS\s+(.+)$/);
    const failMatch = line.match(/^FAIL\s+(.+)$/);
    if (passMatch || failMatch) {
      currentFile = (passMatch ?? failMatch)?.[1]?.trim() ?? "";
      continue;
    }
    const testMatch = line.match(/^\s+([✓✕])\s+(.+)$/);
    if (testMatch && currentFile) {
      const passed = testMatch[1] === "✓";
      const testName = `${currentFile} > ${testMatch[2]!.trim()}`;
      results.push({ testName, passed });
    }
  }
  return results;
}

function parseVitestOutput(output: string): ParsedTestResult[] {
  const results: ParsedTestResult[] = [];
  const lines = output.split("\n");
  let currentFile = "";
  for (const line of lines) {
    const suiteMatch = line.match(/^\s*[✓✗×]\s+(.+?)\s+\(/);
    if (suiteMatch) {
      currentFile = suiteMatch[1]!.trim();
      continue;
    }
    const testMatch = line.match(/^\s+[✓✗×]\s+(.+)$/);
    if (testMatch && currentFile) {
      const symbol = line.trim()[0];
      const testName = `${currentFile} > ${testMatch[1]!.trim()}`;
      results.push({ testName, passed: symbol === "✓" });
    }
  }
  return results;
}

async function validateBehavioralReproduction(input: {
  caseVersion: ValidationRunnerCaseVersion;
  behavioralReproduction: { script: string; rationale: string };
  executor: GitCommandExecutor;
  commandTimeoutMs: number;
}): Promise<BehavioralReproductionResult> {
  const cloned = await cloneAndSetupRepository({
    caseVersion: input.caseVersion,
    executor: input.executor,
    commandTimeoutMs: input.commandTimeoutMs,
  });

  if (cloned.setupIssues.length > 0) {
    return {
      reproducedOnBase: false,
      fixedOnGold: false,
      baseResults: { exitCode: 1, stdout: "", stderr: "", timedOut: false },
      goldResults: { exitCode: 1, stdout: "", stderr: "", timedOut: false },
      issues: cloned.setupIssues,
    };
  }

  const scriptName = ".pilab-repro";
  const baseScriptPath = path.join(cloned.basePath, scriptName);
  const goldScriptPath = path.join(cloned.goldPath, scriptName);

  try {
    await Promise.all([
      writeRuntimeFile(input.executor, cloned.basePath, scriptName, input.behavioralReproduction.script, "755"),
      writeRuntimeFile(input.executor, cloned.goldPath, scriptName, input.behavioralReproduction.script, "755"),
    ]);

    const [chmodBase, chmodGold] = await Promise.all([
      input.executor.runShell({ command: `chmod +x ${scriptName}`, cwd: cloned.basePath, timeoutMs: 10_000 }),
      input.executor.runShell({ command: `chmod +x ${scriptName}`, cwd: cloned.goldPath, timeoutMs: 10_000 }),
    ]);

    if (chmodBase.exitCode !== 0 || chmodGold.exitCode !== 0) {
      return {
        reproducedOnBase: false,
        fixedOnGold: false,
        baseResults: sanitizeCommandResult(chmodBase),
        goldResults: sanitizeCommandResult(chmodGold),
        issues: [{
          severity: "error",
          code: "repro_script_chmod_failed",
          message: "Failed to make reproduction script executable.",
        }],
      };
    }

    const [baseResult, goldResult] = await Promise.all([
      input.executor.runShell({ command: `./${scriptName}`, cwd: cloned.basePath, timeoutMs: input.commandTimeoutMs }),
      input.executor.runShell({ command: `./${scriptName}`, cwd: cloned.goldPath, timeoutMs: input.commandTimeoutMs }),
    ]);

    return {
      reproducedOnBase: baseResult.exitCode !== 0,
      fixedOnGold: goldResult.exitCode === 0,
      baseResults: sanitizeCommandResult(baseResult),
      goldResults: sanitizeCommandResult(goldResult),
      issues: [],
    };
  } finally {
    await cleanupClonedRepository(input.executor, cloned);
  }
}

async function validateProposedTests(input: {
  caseVersion: ValidationRunnerCaseVersion;
  proposedTests: ValidationRunnerTestSpec[];
  executor: GitCommandExecutor;
  commandTimeoutMs: number;
  repositoryReady: boolean;
  updateProgress?: (progress: { stage: string; message: string }) => Promise<void>;
}): Promise<TestValidationResult[]> {
  const results: TestValidationResult[] = [];

  // Filter out tests with static issues first
  const executableTests: ValidationRunnerTestSpec[] = [];
  for (const test of input.proposedTests) {
    const staticIssues = validateTestSpecForExecution(test);

    if (!input.repositoryReady) {
      staticIssues.push({
        severity: "warning",
        code: "repository_not_ready",
        message: "Repository commits could not be fetched — will retry clone during setup.",
      });
    }

    if (staticIssues.some((issue) => issue.severity === "error")) {
      results.push({
        testSpecId: test.id,
        name: test.name,
        kind: test.kind,
        status: "rejected",
        issues: staticIssues,
      });
      continue;
    }

    executableTests.push(test);
  }

  if (executableTests.length === 0) {
    return results;
  }

  // Clone once and install dependencies
  if (input.updateProgress) {
    await input.updateProgress({ stage: "setting-up-environment", message: "Setting up environment" });
  }
  const cloned = await cloneAndSetupRepository({
    caseVersion: input.caseVersion,
    executor: input.executor,
    commandTimeoutMs: input.commandTimeoutMs,
  });

  if (cloned.setupIssues.length > 0) {
    for (const test of executableTests) {
      results.push({
        testSpecId: test.id,
        name: test.name,
        kind: test.kind,
        status: "rejected",
        issues: cloned.setupIssues,
      });
    }
    await cleanupClonedRepository(input.executor, cloned);
    return results;
  }

  // Run all tests against the same cloned directories
  for (const test of executableTests) {
    results.push(await executeTestSpec({
      caseVersion: input.caseVersion,
      executor: input.executor,
      commandTimeoutMs: input.commandTimeoutMs,
      cloned,
    }, test));
  }

  // Cleanup cloned directories
  await cleanupClonedRepository(input.executor, cloned);

  return results;
}

async function cleanupClonedRepository(
  executor: GitCommandExecutor,
  cloned: ClonedRepository,
): Promise<void> {
  await Promise.all([
    executor.cleanupPath?.(cloned.basePath).catch(() => {}),
    executor.cleanupPath?.(cloned.goldPath).catch(() => {}),
    rm(cloned.basePath, { recursive: true, force: true }).catch(() => {}),
    rm(cloned.goldPath, { recursive: true, force: true }).catch(() => {}),
  ]);
}

function validateTestSpecForExecution(
  test: ValidationRunnerTestSpec,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!test.filePath) {
    issues.push({
      severity: "error",
      code: "file_path_missing",
      message: "Proposed tests must include a relative file path before execution.",
    });
  } else if (path.isAbsolute(test.filePath) || test.filePath.includes("..")) {
    issues.push({
      severity: "error",
      code: "file_path_unsafe",
      message: "Proposed test file path must stay inside the repository.",
    });
  }

  if (!test.content) {
    issues.push({
      severity: "error",
      code: "content_missing",
      message: "Proposed tests must include test file content before execution.",
    });
  }

  if (!isAllowedTestCommand(test.testCommand)) {
    issues.push({
      severity: "error",
      code: "test_command_not_allowed",
      message: "Test command is not an allowed shell test command.",
    });
  }

  return issues;
}

async function cloneAndSetupRepository(input: {
  caseVersion: ValidationRunnerCaseVersion;
  executor: GitCommandExecutor;
  commandTimeoutMs: number;
}): Promise<ClonedRepository> {
  const repoUrl = `https://github.com/${input.caseVersion.repoOwner}/${input.caseVersion.repoName}.git`;
  const image = selectImageForRepo(input.caseVersion.repoOwner, input.caseVersion.repoName);
  const tempRoot = await mkdtemp(path.join(tmpdir(), "pilab-validation-"));
  const basePath = path.join(tempRoot, "base");
  const goldPath = path.join(tempRoot, "gold");
  const goldCommitSha = input.caseVersion.goldCommitSha;

  if (!goldCommitSha) {
    return {
      basePath,
      goldPath,
      baseCommitSha: input.caseVersion.baseCommitSha,
      goldCommitSha: "",
      setupIssues: [{
        severity: "error",
        code: "gold_commit_missing",
        message: "Case version has no gold commit SHA.",
      }],
    };
  }

  try {
    const [baseResults, goldResults] = await Promise.all([
      input.executor.fetchCommit({
        repoUrl,
        commitSha: input.caseVersion.baseCommitSha,
        destinationPath: basePath,
        timeoutMs: input.commandTimeoutMs,
        image,
      }),
      input.executor.fetchCommit({
        repoUrl,
        commitSha: goldCommitSha,
        destinationPath: goldPath,
        timeoutMs: input.commandTimeoutMs,
        image,
      }),
    ]);

    const issues: ValidationIssue[] = [];

    const baseFailed = baseResults.some((r) => r.exitCode !== 0);
    const goldFailed = goldResults.some((r) => r.exitCode !== 0);

    if (baseFailed) {
      issues.push({
        severity: "error",
        code: "base_clone_failed",
        message: `Failed to clone base commit ${input.caseVersion.baseCommitSha}.`,
      });
    }

    if (goldFailed) {
      issues.push({
        severity: "error",
        code: "gold_clone_failed",
        message: `Failed to clone gold commit ${goldCommitSha}.`,
      });
    }

    if (issues.length > 0) {
      return { basePath, goldPath, baseCommitSha: input.caseVersion.baseCommitSha, goldCommitSha, setupIssues: issues };
    }

    // Workaround for setuptools_scm: shallow clones break version detection.
    // Write a fallback _version.py for packages that use setuptools_scm.
    await Promise.all([
      writeSetuptoolsScmFallback(input.executor, basePath),
      writeSetuptoolsScmFallback(input.executor, goldPath),
    ]);

    // Install dependencies using LLM-driven setup agent
    const setupResult = await setupEnvironment(
      basePath,
      goldPath,
      input.executor,
      input.commandTimeoutMs,
    );

    return {
      basePath,
      goldPath,
      baseCommitSha: input.caseVersion.baseCommitSha,
      goldCommitSha,
      setupIssues: setupResult.issues,
    };
  } catch (error) {
    return {
      basePath,
      goldPath,
      baseCommitSha: input.caseVersion.baseCommitSha,
      goldCommitSha,
      setupIssues: [{
        severity: "error",
        code: "clone_exception",
        message: error instanceof Error ? error.message : "Repository clone failed",
      }],
    };
  }
}

async function executeTestSpec(
  input: {
    caseVersion: ValidationRunnerCaseVersion;
    executor: GitCommandExecutor;
    commandTimeoutMs: number;
    cloned: ClonedRepository;
  },
  test: ValidationRunnerTestSpec,
): Promise<TestValidationResult> {
  const basePath = input.cloned.basePath;
  const goldPath = input.cloned.goldPath;

  if (!test.filePath || !test.content) {
    throw new Error("Execution called without required validated inputs");
  }

  await Promise.all([
    materializeTestFile(input.executor, basePath, test.filePath, test.content),
    materializeTestFile(input.executor, goldPath, test.filePath, test.content),
  ]);

  // For Python test commands, prepend PYTHONPATH=. so tests can import the local
  // package even when pip install -e . failed (common for C-extension projects).
  // SETUPTOOLS_SCM_PRETEND_VERSION prevents setuptools_scm from failing on shallow clones.
  // Rewrite "pytest" / "python -m pytest" to use the venv path directly — the venv
  // bin directory is not on the system PATH in E2B sandboxes.
  // Inject -W ignore to avoid warnings-as-errors conflicts with astropy's logger.
  const pythonTestCommand = isPythonTestCommand(test.testCommand)
    ? `SETUPTOOLS_SCM_PRETEND_VERSION=0.0.0 PYTHONPATH=. ${test.testCommand
      .replace(/^pytest\b/, ".venv/bin/pytest -W ignore")
      .replace(/^python\s+-m\s+pytest\b/, ".venv/bin/python -m pytest -W ignore")
      .replace(/\bpytest\b/, ".venv/bin/pytest -W ignore")}`
    : test.testCommand;

  let [baseResult, goldResult] = await Promise.all([
    input.executor.runShell({
      command: pythonTestCommand,
      cwd: basePath,
      timeoutMs: input.commandTimeoutMs,
    }),
    input.executor.runShell({
      command: pythonTestCommand,
      cwd: goldPath,
      timeoutMs: input.commandTimeoutMs,
    }),
  ]);

  // If pytest is not on PATH, retry with the venv pytest
  const pytestNotFound =
    baseResult.stderr.includes("pytest: command not found") ||
    goldResult.stderr.includes("pytest: command not found") ||
    baseResult.stderr.includes("No module named pytest") ||
    goldResult.stderr.includes("No module named pytest") ||
    baseResult.exitCode === 127 ||
    goldResult.exitCode === 127;
  if (pytestNotFound && isPythonTestCommand(test.testCommand)) {
    const fallbackCommand = test.testCommand
      .replace(/^pytest\b/, ".venv/bin/pytest")
      .replace(/^python\s+-m\s+pytest\b/, ".venv/bin/python -m pytest")
      .replace(/\bpytest\b/, "pytest -W ignore");
    const fallbackPythonCommand = isPythonTestCommand(fallbackCommand)
      ? `SETUPTOOLS_SCM_PRETEND_VERSION=0.0.0 PYTHONPATH=. ${fallbackCommand}`
      : fallbackCommand;
    console.log(`[validation-runner] Retrying with venv pytest: ${fallbackPythonCommand}`);
    [baseResult, goldResult] = await Promise.all([
      input.executor.runShell({
        command: fallbackPythonCommand,
        cwd: basePath,
        timeoutMs: input.commandTimeoutMs,
      }),
      input.executor.runShell({
        command: fallbackPythonCommand,
        cwd: goldPath,
        timeoutMs: input.commandTimeoutMs,
      }),
    ]);
  }

  // Self-heal: if test failed with ModuleNotFoundError, install the missing dep and retry
  if ((baseResult.exitCode !== 0 || goldResult.exitCode !== 0) && isPythonTestCommand(test.testCommand)) {
    const missingModules = extractMissingModules(baseResult.stderr, goldResult.stderr);
    if (missingModules.length > 0) {
      console.log(`[validation-runner] Missing modules detected: ${missingModules.join(", ")}. Installing...`);
      const pip = ".venv/bin/pip";
      const installCmds = missingModules.map(m => `${pip} install ${m} 2>&1 || true`).join(" && ");
      await input.executor.runShell({ command: installCmds, cwd: basePath, timeoutMs: 60_000 });
      await input.executor.runShell({ command: installCmds, cwd: goldPath, timeoutMs: 60_000 });
      // Retry test after installing missing deps
      [baseResult, goldResult] = await Promise.all([
        input.executor.runShell({ command: pythonTestCommand, cwd: basePath, timeoutMs: input.commandTimeoutMs }),
        input.executor.runShell({ command: pythonTestCommand, cwd: goldPath, timeoutMs: input.commandTimeoutMs }),
      ]);
    }
  }

  const basePassed = baseResult.exitCode === 0;
  const goldPassed = goldResult.exitCode === 0;
  const accepted = test.kind === "fail_to_pass"
    ? !basePassed && goldPassed
    : basePassed && goldPassed;

  const issues: ValidationIssue[] = [];
  if (!accepted) {
    const baseSetupError = detectSetupError(baseResult);
    const goldSetupError = detectSetupError(goldResult);
    if (baseSetupError || goldSetupError) {
      const preview = (s: string, max: number) => s.length > max ? s.slice(0, max) + "..." : s;
      issues.push({
        severity: "error",
        code: "test_setup_failed",
        message: [
          baseSetupError && `Base commit: ${baseSetupError}`,
          goldSetupError && `Gold commit: ${goldSetupError}`,
          baseResult.stderr && `Base stderr (preview): ${preview(baseResult.stderr, 500)}`,
          goldResult.stderr && `Gold stderr (preview): ${preview(goldResult.stderr, 500)}`,
        ].filter(Boolean).join("\n"),
      });
    } else {
      const preview = (s: string, max: number) => s.length > max ? s.slice(0, max) + "..." : s;
      const baseOut = baseResult.stderr || baseResult.stdout;
      const goldOut = goldResult.stderr || goldResult.stdout;
      issues.push({
        severity: "error",
        code: "pass_fail_contract_not_met",
        message: [
          `Test '${test.name}' (kind: ${test.kind}) did not meet contract.`,
          `Base exit: ${baseResult.exitCode} | Gold exit: ${goldResult.exitCode}`,
          `Base output: ${preview(baseOut, 300)}`,
          `Gold output: ${preview(goldOut, 300)}`,
          test.kind === "fail_to_pass"
            ? "Expected base to FAIL and gold to PASS."
            : "Expected both base AND gold to PASS.",
        ].join("\n"),
      });
    }
  }

  return {
    testSpecId: test.id,
    name: test.name,
    kind: test.kind,
    status: accepted ? "accepted" : "rejected",
    base: sanitizeCommandResult(baseResult),
    gold: sanitizeCommandResult(goldResult),
    issues,
  };
}

async function materializeTestFile(
  executor: GitCommandExecutor,
  repositoryPath: string,
  filePath: string,
  content: string,
): Promise<void> {
  if (executor.writeFile) {
    await executor.writeFile({
      cwd: repositoryPath,
      filePath,
      content: `${content}\n`,
    });
    return;
  }

  const resolved = path.resolve(repositoryPath, filePath);
  const repositoryRoot = path.resolve(repositoryPath);

  if (!resolved.startsWith(repositoryRoot + path.sep)) {
    throw new Error(`Unsafe test file path: ${filePath}`);
  }

  await mkdir(path.dirname(resolved), { recursive: true });
  await writeFile(resolved, `${content}\n`, "utf8");
}

/** Extract Python package names from ModuleNotFoundError/ImportError messages */
function extractMissingModules(stderrBase: string, stderrGold: string): string[] {
  const both = `${stderrBase}\n${stderrGold}`;
  const names = new Set<string>();
  // Pattern: ModuleNotFoundError: No module named '<pkg>'
  const re = /(?:ModuleNotFoundError|ImportError).*?No module named ['"]?([a-zA-Z_][a-zA-Z0-9_.]*)['"]?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(both)) !== null) {
    const raw = m[1];
    if (!raw) continue;
    // Map dotted module paths to top-level package: e.g. sqlfluff.cli.commands → sqlfluff
    const top = raw.split(".")[0];
    if (top && top !== "pytest") names.add(top);
  }
  return [...names];
}

function detectSetupError(result: CommandResult): string | null {
  if (result.exitCode === 0) return null;

  const combined = `${result.stdout}\n${result.stderr}`;
  const combinedLower = combined.toLowerCase();

  // Python: NameError — usually means a missing import in the test file itself
  if (combinedLower.includes("nameerror: name 'pytest' is not defined") ||
      combinedLower.includes("nameerror: name 'np' is not defined") ||
      combinedLower.includes("nameerror: name 'pd' is not defined")) {
    return `Test file references undefined symbols — likely missing import statements. Error: ${result.stderr.split('\n')[0]}`;
  }

  // Python ModuleNotFoundError
  if (combinedLower.includes("modulenotfounderror") || combinedLower.includes("importerror")) {
    const lines = result.stderr.split('\n').filter(l => l.includes("ModuleNotFoundError") || l.includes("ImportError") || l.includes("No module named"));
    return `Missing Python dependency — ${lines[0] || result.stderr.split('\n')[0]}`;
  }

  // Module resolution errors (Node)
  if (combinedLower.includes("cannot find module") ||
      combinedLower.includes("failed to resolve") ||
      combinedLower.includes("module not found") ||
      combinedLower.includes("cannot resolve")) {
    return "Module resolution failed — dependencies or workspace packages may not be properly installed";
  }

  // pytest collection errors
  if (result.exitCode === 2 || result.exitCode === 4) {
    const errorLine = result.stderr.split('\n').slice(0, 5).join('\n');
    return `Test collection failed (exit ${result.exitCode}) — ${errorLine}`;
  }

  // No tests found
  if (combinedLower.includes("no tests") || combinedLower.includes("0 tests")) {
    return "No tests executed — test file may not be discoverable";
  }

  // TypeScript compilation errors
  if (combinedLower.includes("typescript") && combinedLower.includes("error")) {
    return "TypeScript compilation failed";
  }

  // Syntax errors
  if (combinedLower.includes("syntax error") || combinedLower.includes("unexpected token")) {
    return "Syntax error in test or source code";
  }

  // Timeout
  if (result.timedOut) {
    return "Test execution timed out";
  }

  return null;
}

function createRuntimeGitCommandExecutor(runtime: RuntimeProvider): GitCommandExecutor {
  const workspacesByPath = new Map<string, RuntimeWorkspace>();

  function workspaceFor(cwd: string): RuntimeWorkspace {
    const workspace = workspacesByPath.get(cwd);
    if (!workspace) {
      throw new Error(`No Daytona workspace registered for ${cwd}`);
    }
    return workspace;
  }

  return {
    async fetchCommit(input) {
      try {
        const workspace = await cloneRepoAtCommitInRuntime({
          runtime,
          workspaceId: `validation-${path.basename(path.dirname(input.destinationPath))}-${path.basename(input.destinationPath)}`,
          repoUrl: input.repoUrl,
          commitSha: input.commitSha,
          timeoutMs: input.timeoutMs,
          ...(input.image ? { image: input.image } : {}),
        });
        workspacesByPath.set(input.destinationPath, workspace);
        return [{ exitCode: 0, stdout: workspace.rootPath, stderr: "", timedOut: false }];
      } catch (error) {
        return [{
          exitCode: 1,
          stdout: "",
          stderr: error instanceof Error ? error.message : String(error),
          timedOut: false,
        }];
      }
    },
    async runShell(input) {
      const workspace = workspaceFor(input.cwd);
      return workspace.run({
        command: input.command,
        cwd: workspace.rootPath,
        timeoutMs: input.timeoutMs,
      });
    },
    async writeFile(input) {
      const workspace = workspaceFor(input.cwd);
      await workspace.writeFile({
        path: input.filePath,
        content: input.content,
        ...(input.mode ? { mode: input.mode } : {}),
      });
    },
    async readFile(input) {
      return workspaceFor(input.cwd).readFile(input.filePath);
    },
    async fileExists(input) {
      const workspace = workspaceFor(input.cwd);
      const result = await workspace.run({
        command: `test -e ${shellQuote(input.filePath)}`,
        cwd: workspace.rootPath,
        timeoutMs: 10_000,
      });
      return result.exitCode === 0;
    },
    async cleanupPath(pathToCleanup) {
      const workspace = workspacesByPath.get(pathToCleanup);
      if (workspace) {
        workspacesByPath.delete(pathToCleanup);
        await workspace.delete();
      }
    },
  };
}

async function writeRuntimeFile(
  executor: GitCommandExecutor,
  cwd: string,
  filePath: string,
  content: string,
  mode?: string,
): Promise<void> {
  if (executor.writeFile) {
    await executor.writeFile({ cwd, filePath, content, ...(mode ? { mode } : {}) });
    return;
  }

  const resolved = path.resolve(cwd, filePath);
  const root = path.resolve(cwd);
  if (!resolved.startsWith(root + path.sep)) {
    throw new Error(`Unsafe file path: ${filePath}`);
  }
  await mkdir(path.dirname(resolved), { recursive: true });
  await writeFile(resolved, content, "utf8");
}

async function runtimeFileExists(
  executor: GitCommandExecutor,
  cwd: string,
  filePath: string,
): Promise<boolean> {
  if (executor.fileExists) {
    return executor.fileExists({ cwd, filePath });
  }
  const { stat } = await import("node:fs/promises");
  try {
    await stat(path.join(cwd, filePath));
    return true;
  } catch {
    return false;
  }
}

async function writeSetuptoolsScmFallback(executor: GitCommandExecutor, cwd: string): Promise<void> {
  try {
    const pyprojectExists = await runtimeFileExists(executor, cwd, "pyproject.toml");
    if (!pyprojectExists) return;

    // Use runShell to read pyproject.toml to avoid potential readFile issues
    const catResult = await executor.runShell({
      command: "cat pyproject.toml",
      cwd,
      timeoutMs: 10_000,
    });
    if (catResult.exitCode !== 0) return;
    if (!catResult.stdout.includes("setuptools_scm")) return;

    // Find the top-level Python package directories by looking for __init__.py
    const result = await executor.runShell({
      command: "find . -maxdepth 2 -name '__init__.py' -not -path './.*' | head -20",
      cwd,
      timeoutMs: 10_000,
    });
    if (result.exitCode !== 0) return;

    const packageDirs = result.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("./") && line.endsWith("/__init__.py"))
      .map((line) => line.slice(2, -"/__init__.py".length))
      .filter((name) => name && !name.includes("/"));

    for (const pkg of packageDirs) {
      const versionPath = `${pkg}/_version.py`;
      const hasVersion = await runtimeFileExists(executor, cwd, versionPath);
      if (!hasVersion) {
        await executor.runShell({
          command: `printf '%s\\n' 'version = "0.0.0"' > ${shellQuote(versionPath)}`,
          cwd,
          timeoutMs: 10_000,
        });
      }
    }
  } catch (error) {
    console.warn(`[validation-runner] setuptools_scm fallback failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function runFile(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    shell?: boolean;
    timeoutMs: number;
  },
): Promise<CommandResult> {
  try {
    const result = await execFileAsync(command, args, {
      cwd: options.cwd,
      shell: options.shell,
      timeout: options.timeoutMs,
      maxBuffer: 1024 * 1024,
    });

    return {
      exitCode: 0,
      stdout: result.stdout,
      stderr: result.stderr,
      timedOut: false,
    };
  } catch (error) {
    const maybeError = error as {
      code?: number | string;
      signal?: string;
      stdout?: string;
      stderr?: string;
      killed?: boolean;
    };

    return {
      exitCode: typeof maybeError.code === "number" ? maybeError.code : 1,
      stdout: maybeError.stdout ?? "",
      stderr: maybeError.stderr ?? "",
      timedOut: maybeError.killed === true || maybeError.signal === "SIGTERM",
    };
  }
}

function summarizeFetch(
  label: "base" | "gold",
  commitSha: string,
  results: CommandResult[],
): RepositoryFetchCheck {
  const failed = results.find((result) => result.exitCode !== 0 || result.timedOut);

  return {
    label,
    commitSha,
    ok: !failed,
    commandCount: results.length,
    failure: failed ? sanitizeCommandResult(failed) : null,
  };
}

function sanitizeCommandResult(result: CommandResult): CommandResult {
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.slice(-4_000),
    stderr: result.stderr.slice(-4_000),
    timedOut: result.timedOut,
  };
}

async function markErrorIfPossible(input: {
  store: ValidationRunnerStore;
  data: ValidationRunnerJobData;
  runnerVersion: string;
  startedAt: string;
  completedAt: string;
  error: unknown;
}): Promise<void> {
  try {
    await input.store.finishAttempt({
      attemptId: input.data.validationAttemptId,
      caseVersionId: input.data.caseVersionId,
      status: "error",
      acceptedTestIds: [],
      rejectedTestIds: [],
      runnerVersion: input.runnerVersion,
      rawResults: {
        source: "validation-runner",
        status: "error",
        runnerVersion: input.runnerVersion,
        startedAt: input.startedAt,
        completedAt: input.completedAt,
        error: input.error instanceof Error ? input.error.message : String(input.error),
      },
    });
  } catch {
    // Preserve the original worker error.
  }
}

function selectImageForRepo(repoOwner: string, repoName: string, mergedAt?: string): string {
  // Map Python release dates to decide base image.
  // Python 3.9 = Oct 2020, 3.10 = Oct 2021, 3.11 = Oct 2022.
  // For PRs merged before Oct 2022, prefer an older Python image.
  if (mergedAt) {
    const merged = new Date(mergedAt);
    const py310Release = new Date("2021-10-04");
    const py311Release = new Date("2022-10-24");
    if (merged < py310Release) return "python:3.9-bullseye";
    if (merged < py311Release) return "python:3.10-bullseye";
  }
  // Default: modern Python with full build toolchain
  return "python:3.11-bookworm";
}

function isCommitSha(value: string): boolean {
  return /^[a-f0-9]{40}$/i.test(value);
}

function isAllowedTestCommand(command: string): boolean {
  const trimmed = command.trim();
  return [
    "pnpm ",
    "npm ",
    "yarn ",
    "npx ",
    "node ",
    "bun ",
    "pytest ",
    "pytest",
    "python ",
    "go test",
    "cargo test",
    "mvn ",
    "gradle ",
    "./gradlew",
  ].some((prefix) => trimmed === prefix.trim() || trimmed.startsWith(prefix));
}

function isPythonTestCommand(command: string): boolean {
  const trimmed = command.trim();
  return trimmed.startsWith("pytest") || trimmed.startsWith("python -m pytest");
}

function readOptionalString(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) return undefined;
  const item = value[key];
  return typeof item === "string" && item.length > 0 ? item : undefined;
}

function readArray(value: unknown, key: string): unknown[] {
  if (!isRecord(value)) return [];
  const item = value[key];
  return Array.isArray(item) ? item : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type ValidationIssue = {
  severity: "warning" | "error";
  code: string;
  message: string;
};

type RepositoryFetchCheck = {
  label: "base" | "gold";
  commitSha: string;
  ok: boolean;
  commandCount: number;
  failure: CommandResult | null;
};

type RepositoryCheckResult = {
  repoUrl: string;
  ready: boolean;
  checks: RepositoryFetchCheck[];
  issues: ValidationIssue[];
};

type TestValidationResult = {
  testSpecId: string;
  name: string;
  kind: "fail_to_pass" | "pass_to_pass";
  status: "accepted" | "rejected";
  issues: ValidationIssue[];
  base?: CommandResult;
  gold?: CommandResult;
};

type TestPatchValidationResult = {
  failToPassTests: string[];
  passToPassTests: string[];
  failToFailTests: string[];
  baseResults: CommandResult;
  goldResults: CommandResult;
  issues: ValidationIssue[];
};

type BehavioralReproductionResult = {
  reproducedOnBase: boolean;
  fixedOnGold: boolean;
  baseResults: CommandResult;
  goldResults: CommandResult;
  issues: ValidationIssue[];
};
