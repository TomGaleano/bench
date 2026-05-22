import { Job, Queue, QueueEvents, Worker, type JobsOptions, type Processor } from "bullmq";
import { Redis } from "ioredis";

export const PLAYGROUND_QUEUE_NAME = "pilab.playground";
export const PLAYGROUND_RUN_JOB_NAME = "playground.run-session";

/**
 * Redis pub/sub channel used to tell the playground worker that a session's
 * sandbox can be torn down. Worker subscribes; API publishes when the user
 * clicks "Continue to scoring", submits scores, or auto-grades.
 */
export const PLAYGROUND_RELEASE_CHANNEL = "pilab.playground.release";

/**
 * Redis pub/sub channel used to cancel a specific agent run mid-flight.
 * Payload format: `${sessionId}:${agentRunId}`. Worker aborts the matching
 * agent's controller; the run is marked failed with cancellation_reason set.
 */
export const PLAYGROUND_CANCEL_RUN_CHANNEL = "pilab.playground.cancel-run";

export async function publishPlaygroundRelease(connection: Redis, sessionId: string): Promise<void> {
  await connection.publish(PLAYGROUND_RELEASE_CHANNEL, sessionId);
}

export async function publishPlaygroundCancelRun(
  connection: Redis,
  sessionId: string,
  agentRunId: string,
): Promise<void> {
  await connection.publish(PLAYGROUND_CANCEL_RUN_CHANNEL, `${sessionId}:${agentRunId}`);
}

export type PlaygroundSandboxImage = "py" | "node" | "py-node" | "custom";

export interface PlaygroundSessionJobData {
  sessionId: string;
  prompt: string;
  agentRuns: Array<{
    agentRunId: string;
    modelId: string;
    modelName: string;
  }>;
  maxWallClockSeconds: number;
  maxOutputTokensPerAgent?: number;
  tools?: string[];
  sandboxImage?: PlaygroundSandboxImage;
  seedPromptText?: string;
  runTwiceAndAverage?: boolean;
}

export interface PlaygroundSessionJobResult {
  sessionId: string;
  agentResults: Array<{
    agentRunId: string;
    status: "succeeded" | "failed" | "timed_out";
    appUrl: string | null;
    output: string;
    errorMessage?: string;
  }>;
  sandboxId: string | null;
}

export type PlaygroundJobStage =
  | "queued"
  | "preparing-sandbox"
  | "installing-python"
  | "creating-worktrees"
  | "running-agents"
  | "completed"
  | "failed";

export type PlaygroundQueue = Queue<PlaygroundSessionJobData, PlaygroundSessionJobResult>;
export type PlaygroundWorker = Worker<PlaygroundSessionJobData, PlaygroundSessionJobResult>;
export type PlaygroundQueueEvents = QueueEvents;

export type PlaygroundJobProgress = {
  stage: PlaygroundJobStage;
  message: string;
  at: string;
};

export type PlaygroundJobSummary = {
  id: string;
  name: string;
  queueName: typeof PLAYGROUND_QUEUE_NAME;
  state: string;
  progress: boolean | string | number | PlaygroundJobProgress | object;
  attemptsMade: number;
  createdAt: string | null;
  processedAt: string | null;
  finishedAt: string | null;
  failedReason?: string;
  returnvalue?: unknown;
  data: PlaygroundSessionJobData;
};

export function createPlaygroundQueue(input: {
  connection: Redis;
}): PlaygroundQueue {
  return new Queue<PlaygroundSessionJobData, PlaygroundSessionJobResult>(
    PLAYGROUND_QUEUE_NAME,
    {
      connection: input.connection,
      defaultJobOptions: defaultPlaygroundJobOptions(),
    },
  );
}

export function createPlaygroundWorker(input: {
  connection: Redis;
  processor: Processor<PlaygroundSessionJobData, PlaygroundSessionJobResult>;
  concurrency?: number;
}): PlaygroundWorker {
  return new Worker<PlaygroundSessionJobData, PlaygroundSessionJobResult>(
    PLAYGROUND_QUEUE_NAME,
    input.processor,
    {
      connection: input.connection,
      concurrency: input.concurrency ?? 3,
    },
  );
}

export function createPlaygroundQueueEvents(input: {
  connection: Redis;
}): PlaygroundQueueEvents {
  return new QueueEvents(PLAYGROUND_QUEUE_NAME, {
    connection: input.connection,
  });
}

export function createPlaygroundSessionJobId(sessionId: string): string {
  return `playground-session-${sessionId}`;
}

export function createPlaygroundProgress(
  stage: PlaygroundJobStage,
  message: string,
): PlaygroundJobProgress {
  return {
    stage,
    message,
    at: new Date().toISOString(),
  };
}

export async function enqueuePlaygroundSessionJob(
  queue: PlaygroundQueue,
  data: PlaygroundSessionJobData,
): Promise<PlaygroundJobSummary> {
  const job = await queue.add(PLAYGROUND_RUN_JOB_NAME, data, {
    jobId: createPlaygroundSessionJobId(data.sessionId),
  });

  return summarizePlaygroundJob(job, "waiting");
}

export async function getPlaygroundSessionJobSummary(
  queue: PlaygroundQueue,
  sessionId: string,
): Promise<PlaygroundJobSummary | null> {
  const jobId = createPlaygroundSessionJobId(sessionId);
  const job = await queue.getJob(jobId);

  if (!job) {
    return null;
  }

  return summarizePlaygroundJob(job, await job.getState());
}

export async function summarizePlaygroundJob(
  job: Job<PlaygroundSessionJobData, PlaygroundSessionJobResult>,
  state?: string,
): Promise<PlaygroundJobSummary> {
  const id = job.id;

  if (!id) {
    throw new Error("BullMQ returned a job without an id");
  }

  const failedReason = job.failedReason;
  const summary: PlaygroundJobSummary = {
    id,
    name: job.name,
    queueName: PLAYGROUND_QUEUE_NAME,
    state: state ?? (await job.getState()),
    progress: job.progress,
    attemptsMade: job.attemptsMade,
    createdAt: toIso(job.timestamp),
    processedAt: toIso(job.processedOn),
    finishedAt: toIso(job.finishedOn),
    data: job.data,
  };

  if (failedReason) {
    summary.failedReason = failedReason;
  }

  if (job.returnvalue !== undefined) {
    summary.returnvalue = job.returnvalue;
  }

  return summary;
}

function defaultPlaygroundJobOptions(): JobsOptions {
  return {
    attempts: 1,
    removeOnComplete: false,
    removeOnFail: false,
  };
}

function toIso(value: number | undefined): string | null {
  return value ? new Date(value).toISOString() : null;
}
