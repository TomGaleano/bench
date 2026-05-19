import { createDb } from "@pilab/db";
import {
  caseBuilderQueueName,
  createCaseBuilderWorker,
  createRedisConnection,
  createReproductionValidatorQueue,
  createValidationRunnerQueue,
  enqueueReproductionValidatorJob,
  enqueueValidationRunnerJob,
} from "@pilab/jobs";

import {
  createCaseBuilderPrepareProcessor,
  createDrizzleCaseBuilderPreflightStore,
} from "./case-builder-processor.js";
import { createCaseBuilderObjectStore } from "./object-store.js";
import { createOpenRouterTestBuilder } from "./openrouter-test-builder.js";
import { createPiTestBuilder } from "./pi-test-builder.js";
import { createReproductionStepBuilder } from "./reproduction-step-builder.js";

const databaseUrl = readRequiredEnv("DATABASE_URL");
const redisUrl = readRequiredEnv("REDIS_URL");
const openRouterApiKey = readRequiredEnv("OPENROUTER_API_KEY");
const testBuilderModelId =
  process.env.TEST_BUILDER_MODEL_ID ?? "openai/gpt-5.4-mini";
const usePiTestBuilder = process.env.USE_PI_TEST_BUILDER !== "0";

const db = createDb(databaseUrl);
const connection = createRedisConnection(redisUrl, {
  maxRetriesPerRequest: null,
});
const validationQueue = createValidationRunnerQueue({ connection });
const reproductionValidatorQueue = createReproductionValidatorQueue({ connection });
const processor = createCaseBuilderPrepareProcessor({
  store: createDrizzleCaseBuilderPreflightStore(db),
  objectStore: createCaseBuilderObjectStore(),
  testBuilder: usePiTestBuilder
    ? createPiTestBuilder({
        apiKey: openRouterApiKey,
        modelId: testBuilderModelId,
      })
    : createOpenRouterTestBuilder({
      apiKey: openRouterApiKey,
      modelId: testBuilderModelId,
    }),
  reproductionStepBuilder: createReproductionStepBuilder({
    apiKey: openRouterApiKey,
    modelId: testBuilderModelId,
  }),
  validationRunner: {
    enqueue(data) {
      return enqueueValidationRunnerJob(validationQueue, data);
    },
  },
  reproductionValidator: {
    enqueue(data) {
      return enqueueReproductionValidatorJob(reproductionValidatorQueue, data);
    },
  },
});
const worker = createCaseBuilderWorker({
  connection,
  processor,
});

worker.on("ready", () => {
  console.log(`[case-builder] worker ready for queue ${caseBuilderQueueName}`);
});

worker.on("active", (job) => {
  console.log(`[case-builder] started job ${job.id ?? "(unknown)"}`);
});

worker.on("completed", (job, result) => {
  console.log(
    `[case-builder] completed job ${job.id ?? "(unknown)"} at stage ${result.stage}`,
  );
});

worker.on("failed", (job, error) => {
  console.error(
    `[case-builder] failed job ${job?.id ?? "(unknown)"}: ${error.message}`,
  );
});

worker.on("error", (error) => {
  console.error(`[case-builder] worker error: ${error.message}`);
});

process.once("SIGINT", () => {
  void shutdown("SIGINT");
});

process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  console.log(`[case-builder] received ${signal}; shutting down`);

  try {
    await worker.close();
    await validationQueue.close();
    await reproductionValidatorQueue.close();
    await connection.quit();
    console.log("[case-builder] shutdown complete");
    process.exit(0);
  } catch (error) {
    console.error(
      `[case-builder] shutdown failed: ${
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
