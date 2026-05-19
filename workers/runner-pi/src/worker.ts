import { Worker } from "bullmq";
import { createDb } from "@pilab/db";
import {
  createRedisConnection,
  PI_RUNNER_IMPL_JOB_NAME,
  piRunnerPlanJobName,
  piRunnerQueueName,
  createGradingPlanQueue,
  createGradingImplementationQueue,
  createGradingExternalQueue,
  enqueueGradingPlanJob,
  enqueueGradingImplementationJob,
  enqueueGradingExternalJob,
} from "@pilab/jobs";
import { and, eq } from "drizzle-orm";
import { runs, plans, patches, experiments } from "@pilab/db/schema";

import {
  createDrizzlePiRunnerStore,
  createPiRunnerPlanProcessor,
} from "./pi-runner-processor.js";
import { createPiRunnerImplProcessor } from "./impl.js";

const databaseUrl = readRequiredEnv("DATABASE_URL");
const redisUrl = readRequiredEnv("REDIS_URL");

const db = createDb(databaseUrl);
const connection = createRedisConnection(redisUrl, {
  maxRetriesPerRequest: null,
});

const store = createDrizzlePiRunnerStore(db);

const gradingPlanQueue = createGradingPlanQueue(connection);
const gradingImplementationQueue = createGradingImplementationQueue(connection);
const gradingExternalQueue = createGradingExternalQueue(connection);

const planProcessor = createPiRunnerPlanProcessor({ store });
const implProcessor = createPiRunnerImplProcessor({ store });

const worker = new Worker(
  piRunnerQueueName,
  async (job) => {
    if (job.name === piRunnerPlanJobName) {
      return planProcessor(job as never);
    }
    if (job.name === PI_RUNNER_IMPL_JOB_NAME) {
      return implProcessor(job as never);
    }
    throw new Error(`Unknown job name: ${job.name}`);
  },
  {
    connection,
    concurrency: 1,
  },
);

worker.on("ready", () => {
  console.log(`[pi-runner] worker ready for queue ${piRunnerQueueName}`);
});

worker.on("active", (job) => {
  console.log(
    `[pi-runner] started job ${job.id ?? "(unknown)"} (${job.name})`,
  );
});

worker.on("completed", async (job, result) => {
  console.log(
    `[pi-runner] completed job ${job.id ?? "(unknown)"}`,
  );

  try {
    // Auto-trigger grading for successful runs
    if (result.status === "completed" || result.status === "succeeded") {
      const runId = result.runId;
      
      // Check if this is a plan run or implementation run
      if (job.name === piRunnerPlanJobName) {
        // For plan runs, trigger plan grading
        const planJobId = `grading-plan-${runId}`;
        const planJob = await gradingPlanQueue.getJob(planJobId);
        if (!planJob) {
          await enqueueGradingPlanJob(gradingPlanQueue, {
            runId,
            planId: result.planArtifactId,
            caseVersionId: result.caseVersionId,
          });
          console.log(`[pi-runner] auto-enqueued plan grading for run ${runId}`);
        }
      } else if (job.name === PI_RUNNER_IMPL_JOB_NAME) {
        // For implementation runs, trigger implementation grading
        const implJobId = `grading-implementation-${runId}`;
        const implJob = await gradingImplementationQueue.getJob(implJobId);
        if (!implJob) {
          await enqueueGradingImplementationJob(gradingImplementationQueue, {
            runId,
            patchId: result.patchArtifactId,
            caseVersionId: result.caseVersionId,
          });
          console.log(`[pi-runner] auto-enqueued implementation grading for run ${runId}`);
        }
      }

      // Check if all runs in the experiment have completed
      const run = await db.query.runs.findFirst({
        where: eq(runs.id, runId),
      });

      if (run?.experimentId) {
        // Fetch all runs for this experiment
        const experimentRuns = await db.query.runs.findMany({
          where: eq(runs.experimentId, run.experimentId),
        });

        // Check if all runs have completed (succeeded or failed)
        const completedRuns = experimentRuns.filter(
          (r) => r.status === "succeeded" || r.status === "failed",
        );
        const allCompleted = completedRuns.length === experimentRuns.length;

        if (allCompleted) {
          // Check if there are at least 2 successful runs for external comparison
          const successfulRuns = experimentRuns.filter((r) => r.status === "succeeded");
          if (successfulRuns.length >= 2) {
            // Trigger external grading for all pairs of successful runs
            for (let i = 0; i < successfulRuns.length; i++) {
              for (let j = i + 1; j < successfulRuns.length; j++) {
                const runAId = successfulRuns[i]!.id;
                const runBId = successfulRuns[j]!.id;
                
                await enqueueGradingExternalJob(gradingExternalQueue, {
                  experimentId: run.experimentId!,
                  runAId,
                  runBId,
                });
                
                console.log(`[pi-runner] auto-enqueued external grading for runs ${runAId} vs ${runBId}`);
              }
            }
          }
        }
      }
    }
  } catch (error) {
    console.error(
      `[pi-runner] failed to auto-trigger grading for job ${job.id ?? "(unknown)"}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
});

worker.on("failed", (job, error) => {
  console.error(
    `[pi-runner] failed job ${job?.id ?? "(unknown)"}: ${error.message}`,
  );
});

worker.on("error", (error) => {
  console.error(`[pi-runner] worker error: ${error.message}`);
});

process.once("SIGINT", () => {
  void shutdown("SIGINT");
});

process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  console.log(`[pi-runner] received ${signal}; shutting down`);

  try {
    await worker.close();
    await gradingPlanQueue.close();
    await gradingImplementationQueue.close();
    await gradingExternalQueue.close();
    await connection.quit();
    console.log("[pi-runner] shutdown complete");
    process.exit(0);
  } catch (error) {
    console.error(
      `[pi-runner] shutdown failed: ${
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
