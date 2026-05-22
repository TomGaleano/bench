import { Worker } from "bullmq";
import {
  createRedisConnection,
  PLAYGROUND_CANCEL_RUN_CHANNEL,
  PLAYGROUND_QUEUE_NAME,
  PLAYGROUND_RELEASE_CHANNEL,
  PLAYGROUND_RUN_JOB_NAME,
  createPlaygroundProgress,
  type PlaygroundSessionJobData,
  type PlaygroundSessionJobResult,
} from "@pilab/jobs";
import { runPlaygroundSession } from "./agent.js";

const redisUrl = readRequiredEnv("REDIS_URL");
const openRouterApiKey = readRequiredEnv("OPENROUTER_API_KEY");
const apiBaseUrl = process.env.PLAYGROUND_API_BASE_URL ?? process.env.API_BASE_URL ?? "http://localhost:3001";

const connection = createRedisConnection(redisUrl, {
  maxRetriesPerRequest: null,
});

// Separate connection for pub/sub — ioredis can't subscribe on a connection used for other commands.
const releaseSubscriber = createRedisConnection(redisUrl, {
  maxRetriesPerRequest: null,
});

const MAX_WALL_CLOCK_SECONDS = 600;
// How long to keep the sandbox alive after agents finish, waiting for the user
// to click "Continue to scoring" / submit scores. The frontend's release call
// short-circuits this — this is just the safety cap.
const MAX_REVIEW_SECONDS = 30 * 60;

// Map of sessionId → resolver fn waiting for the release signal.
const pendingReleases = new Map<string, () => void>();

// Map of sessionId → Map of agentRunId → abort handler.
const pendingCancellations = new Map<string, Map<string, () => void>>();

function registerAgentSignal(sessionId: string, agentRunId: string, abort: () => void): () => void {
  let bucket = pendingCancellations.get(sessionId);
  if (!bucket) {
    bucket = new Map();
    pendingCancellations.set(sessionId, bucket);
  }
  bucket.set(agentRunId, abort);
  return () => {
    const b = pendingCancellations.get(sessionId);
    b?.delete(agentRunId);
    if (b && b.size === 0) pendingCancellations.delete(sessionId);
  };
}

releaseSubscriber
  .subscribe(PLAYGROUND_RELEASE_CHANNEL, PLAYGROUND_CANCEL_RUN_CHANNEL)
  .then(() => {
    console.log(
      `[playground-runner] subscribed to ${PLAYGROUND_RELEASE_CHANNEL}, ${PLAYGROUND_CANCEL_RUN_CHANNEL}`,
    );
  })
  .catch((err: unknown) => {
    console.error(`[playground-runner] failed to subscribe:`, err);
  });

releaseSubscriber.on("message", (channel, payload) => {
  if (channel === PLAYGROUND_RELEASE_CHANNEL) {
    const sessionId = payload;
    const resolver = pendingReleases.get(sessionId);
    if (resolver) {
      console.log(`[playground-runner] release signal received for ${sessionId.slice(0, 8)}`);
      pendingReleases.delete(sessionId);
      resolver();
    }
    return;
  }
  if (channel === PLAYGROUND_CANCEL_RUN_CHANNEL) {
    const [sessionId, agentRunId] = payload.split(":");
    if (!sessionId || !agentRunId) return;
    const abort = pendingCancellations.get(sessionId)?.get(agentRunId);
    if (abort) {
      console.log(
        `[playground-runner] cancel-run signal received for ${sessionId.slice(0, 8)} agent ${agentRunId.slice(0, 8)}`,
      );
      abort();
    }
  }
});

function waitForRelease(sessionId: string, timeoutMs: number): Promise<void> {
  return new Promise<void>((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      if (timer) clearTimeout(timer);
      pendingReleases.delete(sessionId);
      resolve();
    };
    pendingReleases.set(sessionId, finish);
    timer = setTimeout(() => {
      console.log(`[playground-runner] review window timeout for ${sessionId.slice(0, 8)} — releasing sandbox`);
      finish();
    }, timeoutMs);
  });
}

const worker = new Worker<PlaygroundSessionJobData, PlaygroundSessionJobResult>(
  PLAYGROUND_QUEUE_NAME,
  async (job) => {
    if (job.name !== PLAYGROUND_RUN_JOB_NAME) {
      throw new Error(`Unknown job name: ${job.name}`);
    }

    const {
      sessionId,
      prompt,
      agentRuns,
      maxWallClockSeconds,
      tools,
      seedPromptText,
      sandboxImage,
      runTwiceAndAverage,
    } = job.data;

    await job.updateProgress(createPlaygroundProgress("preparing-sandbox", "Creating shared sandbox + git worktrees"));

    if (runTwiceAndAverage) {
      // Wired through but not yet doubling the run set — PR-2 adds the averaging path.
      console.log(`[playground-runner] session ${sessionId.slice(0, 8)} requested runTwiceAndAverage; persisted on the session but not yet doubled.`);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), (maxWallClockSeconds ?? MAX_WALL_CLOCK_SECONDS) * 1000);

    try {
      const result = await runPlaygroundSession({
        apiBaseUrl,
        sessionId,
        prompt,
        agentRuns,
        apiKey: openRouterApiKey,
        maxWallClockSeconds: maxWallClockSeconds ?? MAX_WALL_CLOCK_SECONDS,
        maxReviewSeconds: MAX_REVIEW_SECONDS,
        signal: controller.signal,
        waitForRelease,
        registerAgentSignal: (agentRunId, abort) =>
          registerAgentSignal(sessionId, agentRunId, abort),
        ...(tools ? { tools } : {}),
        ...(seedPromptText ? { seedPromptText } : {}),
        ...(sandboxImage ? { sandboxImage } : {}),
      });

      return {
        sessionId,
        sandboxId: result.sandboxId,
        agentResults: result.agentResults,
      };
    } finally {
      clearTimeout(timeout);
      pendingCancellations.delete(sessionId);
    }
  },
  {
    connection,
    // Sessions linger during the review window, so allow many to be in flight.
    concurrency: 10,
  },
);

worker.on("ready", () => {
  console.log(`[playground-runner] worker ready for queue ${PLAYGROUND_QUEUE_NAME} (api=${apiBaseUrl})`);
});

worker.on("active", (job) => {
  console.log(`[playground-runner] started session job ${job.id ?? "(unknown)"} (${job.data.agentRuns?.length ?? "?"} agents)`);
});

worker.on("completed", async (job, result) => {
  const succeeded = result.agentResults.filter((r) => r.status === "succeeded").length;
  const failed = result.agentResults.filter((r) => r.status === "failed").length;
  console.log(`[playground-runner] completed session job ${job.id ?? "(unknown)"} succeeded=${succeeded} failed=${failed}`);
});

worker.on("failed", (job, error) => {
  console.error(`[playground-runner] failed session job ${job?.id ?? "(unknown)"}: ${error.message}`);
});

worker.on("error", (error) => {
  console.error(`[playground-runner] worker error: ${error.message}`);
});

process.once("SIGINT", () => {
  void shutdown("SIGINT");
});

process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  console.log(`[playground-runner] received ${signal}; shutting down`);

  try {
    await worker.close();
    await releaseSubscriber.quit();
    await connection.quit();
    console.log("[playground-runner] shutdown complete");
    process.exit(0);
  } catch (error) {
    console.error(`[playground-runner] shutdown failed: ${error instanceof Error ? error.message : String(error)}`);
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
