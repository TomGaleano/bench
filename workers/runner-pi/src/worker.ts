import { Worker } from "bullmq";
import { createDb } from "@pilab/db";
import {
  createRedisConnection,
  piRunnerBenchmarkBatchJobName,
  piRunnerQueueName,
} from "@pilab/jobs";

import { createBenchmarkBatchProcessor } from "./benchmark-batch-processor.js";

const databaseUrl = readRequiredEnv("DATABASE_URL");
const redisUrl = readRequiredEnv("REDIS_URL");
const openRouterApiKey = readRequiredEnv("OPENROUTER_API_KEY");

const db = createDb(databaseUrl);
const connection = createRedisConnection(redisUrl, {
  maxRetriesPerRequest: null,
});

const batchProcessor = createBenchmarkBatchProcessor({
  db,
  apiKey: openRouterApiKey,
});

const worker = new Worker(
  piRunnerQueueName,
  async (job) => {
    if (job.name === piRunnerBenchmarkBatchJobName) {
      return batchProcessor(job as never);
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

worker.on("completed", (job) => {
  console.log(
    `[pi-runner] completed job ${job.id ?? "(unknown)"}`,
  );
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
