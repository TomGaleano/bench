import { caseVersions } from "@pilab/db";
import { createDb } from "@pilab/db";
import { eq } from "drizzle-orm";
import {
  caseBuilderPrepareJobName,
  createCaseBuilderQueue,
  createRedisConnection,
  createValidationRunnerWorker,
  validationRunnerQueueName,
} from "@pilab/jobs";

import {
  createDrizzleValidationRunnerStore,
  createValidationRunnerProcessor,
} from "./validation-runner.js";
import { createValidationRunnerObjectStore } from "./object-store.js";

const databaseUrl = readRequiredEnv("DATABASE_URL");
const redisUrl = readRequiredEnv("REDIS_URL");

const db = createDb(databaseUrl);
const connection = createRedisConnection(redisUrl, {
  maxRetriesPerRequest: null,
});
const graderConfig =
  process.env.GRADER_API_KEY && process.env.GRADER_MODEL_ID
    ? {
        apiKey: process.env.GRADER_API_KEY,
        modelId: process.env.GRADER_MODEL_ID,
        ...(process.env.GRADER_THRESHOLD
          ? { threshold: Number.parseInt(process.env.GRADER_THRESHOLD, 10) }
          : {}),
      }
    : undefined;

const store = createDrizzleValidationRunnerStore(db);
const processor = createValidationRunnerProcessor({
  store,
  objectStore: createValidationRunnerObjectStore(),
  ...(graderConfig && { grader: graderConfig }),
});
const worker = createValidationRunnerWorker({
  connection,
  processor,
});

const caseBuilderQueue = createCaseBuilderQueue({ connection });

worker.on("ready", () => {
  console.log(`[validation-runner] worker ready for queue ${validationRunnerQueueName}`);
});

worker.on("active", (job) => {
  console.log(`[validation-runner] started job ${job.id ?? "(unknown)"}`);
});

worker.on("completed", async (job, result) => {
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

worker.on("failed", async (job, error) => {
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

worker.on("error", (error) => {
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
      .set({ status: "candidate" })
      .where(eq(caseVersions.id, caseVersion.id));
    console.log(`[validation-runner] Case version ${caseVersion.id} marked as candidate (accepted)`);
    return;
  }

  // Rejected or error: decide whether to retry or fallback
  const strategy = attempt.strategy ?? "unit_tests";
  const attemptNumber = attempt.attemptNumber ?? 1;

  if (strategy === "reproduction_steps") {
    // No more retries after reproduction steps fail
    await db
      .update(caseVersions)
      .set({ status: "rejected" })
      .where(eq(caseVersions.id, caseVersion.id));
    console.log(`[validation-runner] Case version ${caseVersion.id} marked as rejected (reproduction steps failed)`);
    return;
  }

  if (attemptNumber < 3) {
    // Retry with unit tests
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
      strategy: "unit_tests",
      previousAttemptId: attempt.id,
    };
    if (caseVersion.validationLogArtifactId) {
      retryData.previousValidationLogArtifactId = caseVersion.validationLogArtifactId;
    }
    await caseBuilderQueue.add(caseBuilderPrepareJobName, retryData, { jobId: retryJobId });
    console.log(`[validation-runner] Enqueued unit-test retry attempt ${attemptNumber + 1} for case version ${caseVersion.id}`);
    return;
  }

  // Fallback to reproduction steps after 3 failed unit-test attempts
  const fallbackJobId = `case-builder-prepare-${caseVersion.id}-reproduction-steps`;
  const fallbackData: Parameters<typeof caseBuilderQueue.add>[1] = {
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
    strategy: "reproduction_steps",
    previousAttemptId: attempt.id,
  };
  if (caseVersion.validationLogArtifactId) {
    fallbackData.previousValidationLogArtifactId = caseVersion.validationLogArtifactId;
  }
  await caseBuilderQueue.add(caseBuilderPrepareJobName, fallbackData, { jobId: fallbackJobId });
  console.log(`[validation-runner] Enqueued reproduction-steps fallback for case version ${caseVersion.id}`);
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
