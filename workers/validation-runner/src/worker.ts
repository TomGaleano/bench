import { caseVersions } from "@pilab/db";
import { createDb } from "@pilab/db";
import { eq } from "drizzle-orm";
import {
  caseBuilderPrepareJobName,
  createCaseBuilderQueue,
  createRedisConnection,
  createValidationRunnerWorker,
  validationRunnerQueueName,
  type ValidationRunnerJobData,
  type ValidationRunnerJobResult,
} from "@pilab/jobs";

import {
  createDrizzleValidationRunnerStore,
  createValidationRunnerProcessor,
} from "./validation-runner.js";
import { createValidationRunnerObjectStore } from "./object-store.js";

const databaseUrl = readRequiredEnv("DATABASE_URL");
const redisUrl = readRequiredEnv("REDIS_URL");

const MAX_TEST_GEN_ATTEMPTS = 3;

const db = createDb(databaseUrl);
const connection = createRedisConnection(redisUrl, {
  maxRetriesPerRequest: null,
});

const store = createDrizzleValidationRunnerStore(db);
const processor = createValidationRunnerProcessor({
  store,
  objectStore: createValidationRunnerObjectStore(),
});
const worker = createValidationRunnerWorker({
  connection,
  processor,
  concurrency: 3,
});

const caseBuilderQueue = createCaseBuilderQueue({ connection });

worker.on("ready", () => {
  console.log(`[validation-runner] worker ready for queue ${validationRunnerQueueName}`);
});

worker.on("active", (job: { id?: string }) => {
  console.log(`[validation-runner] started job ${job.id ?? "(unknown)"}`);
});

worker.on("completed", async (job: { id?: string; data: ValidationRunnerJobData }, result: ValidationRunnerJobResult) => {
  console.log(
    `[validation-runner] completed job ${job.id ?? "(unknown)"} with status ${result.status}`,
  );

  try {
    await handleValidationCompletion(job.data.validationAttemptId, result.status);
  } catch (error) {
    console.error(
      `[validation-runner] orchestration error after completion: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
});

worker.on("failed", async (job: { id?: string; data: ValidationRunnerJobData } | undefined, error: Error) => {
  console.error(
    `[validation-runner] failed job ${job?.id ?? "(unknown)"}: ${error.message}`,
  );

  if (!job) return;

  try {
    await handleValidationCompletion(job.data.validationAttemptId, "rejected");
  } catch (orchestrationError) {
    console.error(
      `[validation-runner] orchestration error after failure: ${
        orchestrationError instanceof Error ? orchestrationError.message : String(orchestrationError)
      }`,
    );
  }
});

worker.on("error", (error: Error) => {
  console.error(`[validation-runner] worker error: ${error.message}`);
});

process.once("SIGINT", () => {
  void shutdown("SIGINT");
});

process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});

async function handleValidationCompletion(
  validationAttemptId: string,
  status: "accepted" | "rejected" | "error",
): Promise<void> {
  const attempt = await store.findAttemptById(validationAttemptId);
  if (!attempt) {
    console.warn(`[validation-runner] Attempt not found: ${validationAttemptId}`);
    return;
  }

  const caseVersion = await store.findCaseVersionById(attempt.caseVersionId);
  if (!caseVersion) {
    console.warn(`[validation-runner] Case version not found: ${attempt.caseVersionId}`);
    return;
  }

  if (status === "accepted") {
    await db
      .update(caseVersions)
      .set({ status: "candidate", evaluatorStrategy: "deterministic_tests" })
      .where(eq(caseVersions.id, caseVersion.id));
    console.log(
      `[validation-runner] Case version ${caseVersion.id} marked candidate + deterministic_tests`,
    );
    return;
  }

  const attemptNumber = attempt.attemptNumber ?? 1;
  if (attemptNumber < MAX_TEST_GEN_ATTEMPTS) {
    const retryJobId = `case-builder-prepare-${caseVersion.id}-attempt-${attemptNumber + 1}`;
    const retryData: Parameters<typeof caseBuilderQueue.add>[1] = {
      caseId: caseVersion.caseId,
      caseVersionId: caseVersion.id,
      githubIssueId: caseVersion.githubIssueId ?? "",
      githubPullRequestId: caseVersion.githubPullRequestId ?? "",
      artifactIds: {
        issue: caseVersion.issueArtifactId ?? "",
        pullRequest: caseVersion.pullRequestArtifactId ?? "",
        repositoryMetadata: caseVersion.repositoryMetadataArtifactId ?? "",
      },
      enqueuedAt: new Date().toISOString(),
      attemptNumber: attemptNumber + 1,
      previousAttemptId: attempt.id,
    };
    if (caseVersion.validationLogArtifactId) {
      retryData.previousValidationLogArtifactId = caseVersion.validationLogArtifactId;
    }
    await caseBuilderQueue.add(caseBuilderPrepareJobName, retryData, { jobId: retryJobId });
    console.log(
      `[validation-runner] Enqueued test-gen retry attempt ${attemptNumber + 1} for case version ${caseVersion.id}`,
    );
    return;
  }

  // Exhausted deterministic test-gen attempts. Lock the case to llm_evaluator_only;
  // the benchmark runner will spawn a Pi-evaluator agent at run time.
  await db
    .update(caseVersions)
    .set({ status: "candidate", evaluatorStrategy: "llm_evaluator_only" })
    .where(eq(caseVersions.id, caseVersion.id));
  console.log(
    `[validation-runner] Case version ${caseVersion.id} test-gen exhausted (${MAX_TEST_GEN_ATTEMPTS} attempts) — locked to llm_evaluator_only`,
  );
}

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  console.log(`[validation-runner] received ${signal}; shutting down`);

  try {
    await worker.close();
    await connection.quit();
    console.log("[validation-runner] shutdown complete");
    process.exit(0);
  } catch (error) {
    console.error(
      `[validation-runner] shutdown failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    process.exit(1);
  }
}

function readRequiredEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}
