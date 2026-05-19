import { createDb } from "@pilab/db";
import {
  createRedisConnection,
  createReproductionValidatorWorker,
  reproductionValidatorQueueName,
} from "@pilab/jobs";

import {
  createDrizzleReproductionValidatorStore,
  createReproductionValidatorProcessor,
} from "./reproduction-validator.js";

const databaseUrl = readRequiredEnv("DATABASE_URL");
const redisUrl = readRequiredEnv("REDIS_URL");

const db = createDb(databaseUrl);
const connection = createRedisConnection(redisUrl, {
  maxRetriesPerRequest: null,
});

const processorConfig: Parameters<typeof createReproductionValidatorProcessor>[0] = {
  store: createDrizzleReproductionValidatorStore(db),
};

if (process.env.REPRODUCTION_VALIDATOR_MODEL_ID) {
  processorConfig.modelId = process.env.REPRODUCTION_VALIDATOR_MODEL_ID;
}

if (process.env.REPRODUCTION_VALIDATOR_TIMEOUT_SECONDS) {
  processorConfig.maxWallClockSeconds = Number.parseInt(
    process.env.REPRODUCTION_VALIDATOR_TIMEOUT_SECONDS,
    10,
  );
}

const processor = createReproductionValidatorProcessor(processorConfig);

const worker = createReproductionValidatorWorker({
  connection,
  processor,
});

worker.on("ready", () => {
  console.log(`[reproduction-validator] worker ready for queue ${reproductionValidatorQueueName}`);
});

worker.on("active", (job) => {
  console.log(`[reproduction-validator] started job ${job.id ?? "(unknown)"}`);
});

worker.on("completed", (job, result) => {
  console.log(
    `[reproduction-validator] completed job ${job.id ?? "(unknown)"} with status ${result.status}`,
  );
});

worker.on("failed", (job, error) => {
  console.error(
    `[reproduction-validator] failed job ${job?.id ?? "(unknown)"}: ${error.message}`,
  );
});

worker.on("error", (error) => {
  console.error(`[reproduction-validator] worker error: ${error.message}`);
});

process.once("SIGINT", () => {
  void shutdown("SIGINT");
});

process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  console.log(`[reproduction-validator] received ${signal}; shutting down`);

  try {
    await worker.close();
    await connection.quit();
    console.log("[reproduction-validator] shutdown complete");
    process.exit(0);
  } catch (error) {
    console.error(
      `[reproduction-validator] shutdown failed: ${
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
