import {
  Job,
  Queue,
  QueueEvents,
  Worker,
  type JobsOptions,
  type Processor,
} from "bullmq";
import { Redis, type RedisOptions } from "ioredis";

export const caseBuilderQueueName = "pilab.case-builder";
export const caseBuilderPrepareJobName = "case-builder.prepare";
export const validationRunnerQueueName = "pilab.validation-runner";
export const validationRunnerValidateJobName = "validation-runner.validate";
export const piRunnerQueueName = "pilab.pi-runner";
export const piRunnerPlanJobName = "pi-runner.plan";

export const GRADING_PLAN_QUEUE_NAME = "pilab.grading-plan";
export const GRADING_IMPLEMENTATION_QUEUE_NAME = "pilab.grading-implementation";
export const GRADING_EXTERNAL_QUEUE_NAME = "pilab.grading-external";

export const GRADING_PLAN_JOB_NAME = "grading.plan";
export const GRADING_IMPLEMENTATION_JOB_NAME = "grading.implementation";
export const GRADING_EXTERNAL_JOB_NAME = "grading.external";
export const PI_RUNNER_IMPL_JOB_NAME = "pi-runner.impl";

export const reproductionValidatorQueueName = "pilab.reproduction-validator";
export const reproductionValidatorValidateJobName = "reproduction-validator.validate";

// Playground exports
export {
  PLAYGROUND_QUEUE_NAME,
  PLAYGROUND_RUN_JOB_NAME,
  PLAYGROUND_RELEASE_CHANNEL,
  createPlaygroundQueue,
  createPlaygroundWorker,
  createPlaygroundQueueEvents,
  createPlaygroundSessionJobId,
  createPlaygroundProgress,
  enqueuePlaygroundSessionJob,
  getPlaygroundSessionJobSummary,
  publishPlaygroundRelease,
  summarizePlaygroundJob,
} from "./playground.js";

export type {
  PlaygroundSessionJobData,
  PlaygroundSessionJobResult,
  PlaygroundJobStage,
  PlaygroundQueue,
  PlaygroundWorker,
  PlaygroundJobProgress,
  PlaygroundJobSummary,
} from "./playground.js";

export type QueueName =
  | typeof caseBuilderQueueName
  | typeof validationRunnerQueueName
  | typeof piRunnerQueueName
  | typeof GRADING_PLAN_QUEUE_NAME
  | typeof GRADING_IMPLEMENTATION_QUEUE_NAME
  | typeof GRADING_EXTERNAL_QUEUE_NAME
  | typeof reproductionValidatorQueueName;

export type JobName =
  | typeof caseBuilderPrepareJobName
  | typeof validationRunnerValidateJobName
  | typeof piRunnerPlanJobName
  | typeof PI_RUNNER_IMPL_JOB_NAME
  | typeof GRADING_PLAN_JOB_NAME
  | typeof GRADING_IMPLEMENTATION_JOB_NAME
  | typeof GRADING_EXTERNAL_JOB_NAME
  | typeof reproductionValidatorValidateJobName;

export type CaseBuilderJobStage =
  | "queued"
  | "loading-case-version"
  | "validating-artifacts"
  | "ready-for-test-builder"
  | "building-test-candidate"
  | "persisting-proposed-tests"
  | "ready-for-validation"
  | "failed";

export type CaseBuilderPrepareJobData = {
  caseId: string;
  caseVersionId: string;
  githubIssueId: string;
  githubPullRequestId: string;
  artifactIds: {
    issue: string;
    pullRequest: string;
    repositoryMetadata: string;
  };
  enqueuedAt: string;
  attemptNumber?: number;
  strategy?: "unit_tests" | "reproduction_steps";
  previousAttemptId?: string;
  previousValidationLogArtifactId?: string;
};

export type CaseBuilderPrepareJobResult = {
  caseId: string;
  caseVersionId: string;
  stage: "ready-for-test-builder" | "ready-for-validation";
  verifiedArtifactCount: number;
  proposedTestCount?: number;
  failToPassCount?: number;
  passToPassCount?: number;
  candidateTestsArtifactId?: string;
  validationAttemptId?: string;
  validationJobId?: string;
  testBuilderModelId?: string;
  reproductionStepsId?: string;
  reproductionStepsArtifactId?: string;
  strategy?: "unit_tests" | "reproduction_steps";
  completedAt: string;
};

export type CaseBuilderJobProgress = {
  stage: CaseBuilderJobStage;
  message: string;
  at: string;
};

export type CaseBuilderJobSummary = {
  id: string;
  name: string;
  queueName: typeof caseBuilderQueueName;
  state: string;
  progress: boolean | string | number | CaseBuilderJobProgress | object;
  attemptsMade: number;
  createdAt: string | null;
  processedAt: string | null;
  finishedAt: string | null;
  failedReason?: string;
  returnvalue?: unknown;
  data: CaseBuilderPrepareJobData;
};

export type CaseBuilderQueue = Queue<CaseBuilderPrepareJobData, CaseBuilderPrepareJobResult>;
export type CaseBuilderWorker = Worker<CaseBuilderPrepareJobData, CaseBuilderPrepareJobResult>;
export type CaseBuilderQueueEvents = QueueEvents;

export type ValidationRunnerJobStage =
  | "queued"
  | "loading-validation-attempt"
  | "docker-setup"
  | "validating-inputs"
  | "checking-repository-refs"
  | "validating-test-patch"
  | "validating-tests"
  | "running-behavioral-reproduction"
  | "running-grader"
  | "persisting-results"
  | "accepted"
  | "rejected"
  | "error";

export type ValidationRunnerJobData = {
  caseVersionId: string;
  validationAttemptId: string;
  candidateTestsArtifactId: string;
  enqueuedAt: string;
};

export type ValidationRunnerJobResult = {
  caseVersionId: string;
  validationAttemptId: string;
  status: "accepted" | "rejected" | "error";
  acceptedTestCount: number;
  rejectedTestCount: number;
  validationLogArtifact?: ValidationLogArtifactSummary;
  baseLogArtifact?: ValidationLogArtifactSummary;
  goldLogArtifact?: ValidationLogArtifactSummary;
  completedAt: string;
  rejectedTests?: Array<{
    testSpecId: string;
    name: string;
    kind: string;
    issues: Array<{ severity: string; code: string; message: string }>;
  }>;
  failToPassTests?: string[];
  passToPassTests?: string[];
  behavioralReproductionResult?: {
    reproducedOnBase: boolean;
    fixedOnGold: boolean;
  };
  graderResult?: {
    score: number;
    correctness: number;
    completeness: number;
    safety: number;
    reasoning: string;
  };
};

export type ValidationLogArtifactSummary = {
  id: string;
  kind: "validation_log";
  objectKey: string;
  byteSize: number;
  contentType: string;
};

export type ValidationRunnerJobProgress = {
  stage: ValidationRunnerJobStage;
  message: string;
  at: string;
};

export type ValidationRunnerJobSummary = {
  id: string;
  name: string;
  queueName: typeof validationRunnerQueueName;
  state: string;
  progress: boolean | string | number | ValidationRunnerJobProgress | object;
  attemptsMade: number;
  createdAt: string | null;
  processedAt: string | null;
  finishedAt: string | null;
  failedReason?: string;
  returnvalue?: unknown;
  data: ValidationRunnerJobData;
};

export type ValidationRunnerQueue = Queue<
  ValidationRunnerJobData,
  ValidationRunnerJobResult
>;
export type ValidationRunnerWorker = Worker<
  ValidationRunnerJobData,
  ValidationRunnerJobResult
>;
export type ValidationRunnerQueueEvents = QueueEvents;

export type PiRunnerJobStage =
  | "queued"
  | "loading-run"
  | "preparing-workspace"
  | "running-pi"
  | "persisting-artifacts"
  | "completed"
  | "failed";

export type PiRunnerPlanJobData = {
  runId: string;
  caseVersionId: string;
  workspacePath: string;
  modelId: string;
  prompt: string;
  maxTurns: number;
  maxWallClockSeconds: number;
  enqueuedAt: string;
};

export type PiRunnerPlanJobResult = {
  runId: string;
  caseVersionId: string;
  status: "completed" | "failed" | "timeout" | "cancelled";
  planArtifactId?: string;
  planArtifactKey?: string;
  rawSessionArtifactId?: string;
  rawSessionArtifactKey?: string;
  eventCount: number;
  completedAt: string;
  errorMessage?: string;
};

export type PiRunnerJobProgress = {
  stage: PiRunnerJobStage;
  message: string;
  at: string;
};

export type PiRunnerJobSummary = {
  id: string;
  name: string;
  queueName: typeof piRunnerQueueName;
  state: string;
  progress: boolean | string | number | PiRunnerJobProgress | object;
  attemptsMade: number;
  createdAt: string | null;
  processedAt: string | null;
  finishedAt: string | null;
  failedReason?: string;
  returnvalue?: unknown;
  data: PiRunnerPlanJobData;
};

export type PiRunnerQueue = Queue<PiRunnerPlanJobData, PiRunnerPlanJobResult>;
export type PiRunnerWorker = Worker<PiRunnerPlanJobData, PiRunnerPlanJobResult>;
export type PiRunnerQueueEvents = QueueEvents;

export type ReproductionValidatorJobStage =
  | "queued"
  | "loading-reproduction-steps"
  | "cloning-repository"
  | "running-agent-on-base"
  | "running-agent-on-gold"
  | "persisting-results"
  | "accepted"
  | "rejected"
  | "error";

export type ReproductionValidatorJobData = {
  caseVersionId: string;
  reproductionStepsId: string;
  validationAttemptId: string;
  enqueuedAt: string;
};

export type ReproductionValidatorJobResult = {
  caseVersionId: string;
  reproductionStepsId: string;
  validationAttemptId: string;
  status: "accepted" | "rejected" | "error";
  reproducedOnBase: boolean;
  fixedOnGold: boolean;
  baseExitCode: number;
  goldExitCode: number;
  completedAt: string;
  errorMessage?: string;
};

export type ReproductionValidatorJobProgress = {
  stage: ReproductionValidatorJobStage;
  message: string;
  at: string;
};

export type ReproductionValidatorJobSummary = {
  id: string;
  name: string;
  queueName: typeof reproductionValidatorQueueName;
  state: string;
  progress: boolean | string | number | ReproductionValidatorJobProgress | object;
  attemptsMade: number;
  createdAt: string | null;
  processedAt: string | null;
  finishedAt: string | null;
  failedReason?: string;
  returnvalue?: unknown;
  data: ReproductionValidatorJobData;
};

export type ReproductionValidatorQueue = Queue<
  ReproductionValidatorJobData,
  ReproductionValidatorJobResult
>;
export type ReproductionValidatorWorker = Worker<
  ReproductionValidatorJobData,
  ReproductionValidatorJobResult
>;
export type ReproductionValidatorQueueEvents = QueueEvents;

export interface GradingPlanJobData {
  runId: string;
  planId: string;
  caseVersionId: string;
  judgeModelId?: string;
}

export interface GradingPlanJobResult {
  planScoreId: string;
  overallScore: number;
  correctnessScore: number;
  completenessScore: number;
  safetyScore: number;
  rationale: string;
}

export interface GradingImplementationJobData {
  runId: string;
  patchId: string;
  caseVersionId: string;
  judgeModelId?: string;
}

export interface GradingImplementationJobResult {
  implementationScoreId: string;
  overallScore: number;
  diffSimilarityScore: number;
  rationale: string;
}

export interface GradingExternalJobData {
  experimentId: string;
  runAId: string;
  runBId: string;
  judgeModelId?: string;
}

export interface GradingExternalJobResult {
  graderVerdictId: string;
  winnerRunId: string | null;
  rationale: string;
}

export interface PiRunnerImplJobData {
  runId: string;
  caseVersionId: string;
  planRunId: string;
  planArtifactId: string;
  modelId: string;
  maxTurns?: number;
  maxWallClockSeconds?: number;
}

export interface PiRunnerImplJobResult {
  runId: string;
  caseVersionId: string;
  patchArtifactId: string | null;
  testResults: Array<{ testName: string; passed: boolean }>;
  resolved: boolean;
}

export function createRedisConnection(redisUrl: string, options: RedisOptions = {}): Redis {
  return new Redis(redisUrl, options);
}

export function createCaseBuilderQueue(input: {
  connection: Redis;
}): CaseBuilderQueue {
  return new Queue<CaseBuilderPrepareJobData, CaseBuilderPrepareJobResult>(
    caseBuilderQueueName,
    {
      connection: input.connection,
      defaultJobOptions: defaultCaseBuilderJobOptions(),
    },
  );
}

export function createCaseBuilderQueueEvents(input: {
  connection: Redis;
}): CaseBuilderQueueEvents {
  return new QueueEvents(caseBuilderQueueName, {
    connection: input.connection,
  });
}

export function createValidationRunnerQueue(input: {
  connection: Redis;
}): ValidationRunnerQueue {
  return new Queue<ValidationRunnerJobData, ValidationRunnerJobResult>(
    validationRunnerQueueName,
    {
      connection: input.connection,
      defaultJobOptions: defaultValidationRunnerJobOptions(),
    },
  );
}

export function createValidationRunnerQueueEvents(input: {
  connection: Redis;
}): ValidationRunnerQueueEvents {
  return new QueueEvents(validationRunnerQueueName, {
    connection: input.connection,
  });
}

export function createPiRunnerQueue(input: {
  connection: Redis;
}): PiRunnerQueue {
  return new Queue<PiRunnerPlanJobData, PiRunnerPlanJobResult>(
    piRunnerQueueName,
    {
      connection: input.connection,
      defaultJobOptions: defaultPiRunnerJobOptions(),
    },
  );
}

export function createPiRunnerQueueEvents(input: {
  connection: Redis;
}): PiRunnerQueueEvents {
  return new QueueEvents(piRunnerQueueName, {
    connection: input.connection,
  });
}

export function createReproductionValidatorQueue(input: {
  connection: Redis;
}): ReproductionValidatorQueue {
  return new Queue<ReproductionValidatorJobData, ReproductionValidatorJobResult>(
    reproductionValidatorQueueName,
    {
      connection: input.connection,
      defaultJobOptions: defaultReproductionValidatorJobOptions(),
    },
  );
}

export function createReproductionValidatorQueueEvents(input: {
  connection: Redis;
}): ReproductionValidatorQueueEvents {
  return new QueueEvents(reproductionValidatorQueueName, {
    connection: input.connection,
  });
}

export function createGradingPlanQueue(connection: Redis): Queue {
  return new Queue(GRADING_PLAN_QUEUE_NAME, { connection });
}

export function createGradingImplementationQueue(connection: Redis): Queue {
  return new Queue(GRADING_IMPLEMENTATION_QUEUE_NAME, { connection });
}

export function createGradingExternalQueue(connection: Redis): Queue {
  return new Queue(GRADING_EXTERNAL_QUEUE_NAME, { connection });
}

export function createCaseBuilderWorker(input: {
  connection: Redis;
  processor: Processor<CaseBuilderPrepareJobData, CaseBuilderPrepareJobResult>;
  concurrency?: number;
}): CaseBuilderWorker {
  return new Worker<CaseBuilderPrepareJobData, CaseBuilderPrepareJobResult>(
    caseBuilderQueueName,
    input.processor,
    {
      connection: input.connection,
      concurrency: input.concurrency ?? 1,
    },
  );
}

export function createValidationRunnerWorker(input: {
  connection: Redis;
  processor: Processor<ValidationRunnerJobData, ValidationRunnerJobResult>;
  concurrency?: number;
}): ValidationRunnerWorker {
  return new Worker<ValidationRunnerJobData, ValidationRunnerJobResult>(
    validationRunnerQueueName,
    input.processor,
    {
      connection: input.connection,
      concurrency: input.concurrency ?? 1,
    },
  );
}

export function createPiRunnerWorker(input: {
  connection: Redis;
  processor: Processor<PiRunnerPlanJobData, PiRunnerPlanJobResult>;
  concurrency?: number;
}): PiRunnerWorker {
  return new Worker<PiRunnerPlanJobData, PiRunnerPlanJobResult>(
    piRunnerQueueName,
    input.processor,
    {
      connection: input.connection,
      concurrency: input.concurrency ?? 1,
    },
  );
}

export function createReproductionValidatorWorker(input: {
  connection: Redis;
  processor: Processor<ReproductionValidatorJobData, ReproductionValidatorJobResult>;
  concurrency?: number;
}): ReproductionValidatorWorker {
  return new Worker<ReproductionValidatorJobData, ReproductionValidatorJobResult>(
    reproductionValidatorQueueName,
    input.processor,
    {
      connection: input.connection,
      concurrency: input.concurrency ?? 1,
    },
  );
}

export async function enqueueCaseBuilderPrepareJob(
  queue: CaseBuilderQueue,
  data: CaseBuilderPrepareJobData,
): Promise<CaseBuilderJobSummary> {
  const job = await queue.add(caseBuilderPrepareJobName, data, {
    jobId: createCaseBuilderPrepareJobId(data.caseVersionId),
  });

  return summarizeCaseBuilderJob(job, "waiting");
}

export async function getCaseBuilderJobSummary(
  queue: CaseBuilderQueue,
  jobId: string,
): Promise<CaseBuilderJobSummary | null> {
  const job = await queue.getJob(jobId);

  if (!job) {
    return null;
  }

  return summarizeCaseBuilderJob(job, await job.getState());
}

export async function enqueueValidationRunnerJob(
  queue: ValidationRunnerQueue,
  data: ValidationRunnerJobData,
): Promise<ValidationRunnerJobSummary> {
  const job = await queue.add(validationRunnerValidateJobName, data, {
    jobId: createValidationRunnerJobId(data.validationAttemptId),
  });

  return summarizeValidationRunnerJob(job, "waiting");
}

export async function getValidationRunnerJobSummary(
  queue: ValidationRunnerQueue,
  jobId: string,
): Promise<ValidationRunnerJobSummary | null> {
  const job = await queue.getJob(jobId);

  if (!job) {
    return null;
  }

  return summarizeValidationRunnerJob(job, await job.getState());
}

export async function enqueuePiRunnerPlanJob(
  queue: PiRunnerQueue,
  data: PiRunnerPlanJobData,
): Promise<PiRunnerJobSummary> {
  const job = await queue.add(piRunnerPlanJobName, data, {
    jobId: createPiRunnerPlanJobId(data.runId),
  });

  return summarizePiRunnerJob(job, "waiting");
}

export async function getPiRunnerJobSummary(
  queue: PiRunnerQueue,
  jobId: string,
): Promise<PiRunnerJobSummary | null> {
  const job = await queue.getJob(jobId);

  if (!job) {
    return null;
  }

  return summarizePiRunnerJob(job, await job.getState());
}

export async function enqueueGradingPlanJob(
  queue: Queue,
  data: GradingPlanJobData,
  opts?: JobsOptions,
): Promise<Job<GradingPlanJobData, GradingPlanJobResult>> {
  const jobId = createGradingPlanJobId(data.runId);
  return queue.add(GRADING_PLAN_JOB_NAME, data, { ...opts, jobId });
}

export async function enqueueGradingImplementationJob(
  queue: Queue,
  data: GradingImplementationJobData,
  opts?: JobsOptions,
): Promise<Job<GradingImplementationJobData, GradingImplementationJobResult>> {
  const jobId = createGradingImplementationJobId(data.runId);
  return queue.add(GRADING_IMPLEMENTATION_JOB_NAME, data, { ...opts, jobId });
}

export async function enqueueGradingExternalJob(
  queue: Queue,
  data: GradingExternalJobData,
  opts?: JobsOptions,
): Promise<Job<GradingExternalJobData, GradingExternalJobResult>> {
  const jobId = createGradingExternalJobId(data.runAId, data.runBId);
  return queue.add(GRADING_EXTERNAL_JOB_NAME, data, { ...opts, jobId });
}

export async function enqueuePiRunnerImplJob(
  queue: Queue,
  data: PiRunnerImplJobData,
  opts?: JobsOptions,
): Promise<Job<PiRunnerImplJobData, PiRunnerImplJobResult>> {
  const jobId = createPiRunnerImplJobId(data.runId);
  return queue.add(PI_RUNNER_IMPL_JOB_NAME, data, { ...opts, jobId });
}

export async function enqueueReproductionValidatorJob(
  queue: ReproductionValidatorQueue,
  data: ReproductionValidatorJobData,
): Promise<ReproductionValidatorJobSummary> {
  const job = await queue.add(reproductionValidatorValidateJobName, data, {
    jobId: createReproductionValidatorJobId(data.validationAttemptId),
  });

  return summarizeReproductionValidatorJob(job, "waiting");
}

export async function getReproductionValidatorJobSummary(
  queue: ReproductionValidatorQueue,
  jobId: string,
): Promise<ReproductionValidatorJobSummary | null> {
  const job = await queue.getJob(jobId);

  if (!job) {
    return null;
  }

  return summarizeReproductionValidatorJob(job, await job.getState());
}

export type QueueStatus = {
  queueName: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: number;
  hasWorkers: boolean;
};

export async function getQueueStatus(queue: Queue): Promise<QueueStatus> {
  const [
    waiting,
    active,
    completed,
    failed,
    delayed,
  ] = await Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getCompletedCount(),
    queue.getFailedCount(),
    queue.getDelayedCount(),
  ]);

  return {
    queueName: queue.name,
    waiting,
    active,
    completed,
    failed,
    delayed,
    paused: 0,
    hasWorkers: active > 0 || waiting > 0 || completed > 0 || failed > 0,
  };
}

export function createCaseBuilderPrepareJobId(caseVersionId: string): string {
  return `case-builder-prepare-${caseVersionId}`;
}

export function createValidationRunnerJobId(validationAttemptId: string): string {
  return `validation-runner-validate-${validationAttemptId}`;
}

export function createPiRunnerPlanJobId(runId: string): string {
  return `pi-runner-plan-${runId}`;
}

export function createGradingPlanJobId(runId: string): string {
  return `grading-plan-${runId}`;
}

export function createGradingImplementationJobId(runId: string): string {
  return `grading-implementation-${runId}`;
}

export function createGradingExternalJobId(runAId: string, runBId: string): string {
  return `grading-external-${runAId}-${runBId}`;
}

export function createPiRunnerImplJobId(runId: string): string {
  return `pi-runner-impl-${runId}`;
}

export function createReproductionValidatorJobId(validationAttemptId: string): string {
  return `reproduction-validator-${validationAttemptId}`;
}

export function createReproductionValidatorProgress(
  stage: ReproductionValidatorJobStage,
  message: string,
): ReproductionValidatorJobProgress {
  return {
    stage,
    message,
    at: new Date().toISOString(),
  };
}

export async function summarizeReproductionValidatorJob(
  job: Job<ReproductionValidatorJobData, ReproductionValidatorJobResult>,
  state?: string,
): Promise<ReproductionValidatorJobSummary> {
  const id = job.id;

  if (!id) {
    throw new Error("BullMQ returned a job without an id");
  }

  const failedReason = job.failedReason;
  const summary: ReproductionValidatorJobSummary = {
    id,
    name: job.name,
    queueName: reproductionValidatorQueueName,
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

export function createCaseBuilderProgress(
  stage: CaseBuilderJobStage,
  message: string,
): CaseBuilderJobProgress {
  return {
    stage,
    message,
    at: new Date().toISOString(),
  };
}

export function createValidationRunnerProgress(
  stage: ValidationRunnerJobStage,
  message: string,
): ValidationRunnerJobProgress {
  return {
    stage,
    message,
    at: new Date().toISOString(),
  };
}

export function createPiRunnerProgress(
  stage: PiRunnerJobStage,
  message: string,
): PiRunnerJobProgress {
  return {
    stage,
    message,
    at: new Date().toISOString(),
  };
}

export async function summarizeCaseBuilderJob(
  job: Job<CaseBuilderPrepareJobData, CaseBuilderPrepareJobResult>,
  state?: string,
): Promise<CaseBuilderJobSummary> {
  const id = job.id;

  if (!id) {
    throw new Error("BullMQ returned a job without an id");
  }

  const currentState = state ?? (await job.getState());
  const failedReason = currentState === "failed" ? job.failedReason : undefined;
  const summary: CaseBuilderJobSummary = {
    id,
    name: job.name,
    queueName: caseBuilderQueueName,
    state: currentState,
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

export async function summarizeValidationRunnerJob(
  job: Job<ValidationRunnerJobData, ValidationRunnerJobResult>,
  state?: string,
): Promise<ValidationRunnerJobSummary> {
  const id = job.id;

  if (!id) {
    throw new Error("BullMQ returned a job without an id");
  }

  const failedReason = job.failedReason;
  const summary: ValidationRunnerJobSummary = {
    id,
    name: job.name,
    queueName: validationRunnerQueueName,
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

export async function summarizePiRunnerJob(
  job: Job<PiRunnerPlanJobData, PiRunnerPlanJobResult>,
  state?: string,
): Promise<PiRunnerJobSummary> {
  const id = job.id;

  if (!id) {
    throw new Error("BullMQ returned a job without an id");
  }

  const failedReason = job.failedReason;
  const summary: PiRunnerJobSummary = {
    id,
    name: job.name,
    queueName: piRunnerQueueName,
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

function defaultCaseBuilderJobOptions(): JobsOptions {
  return {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 5_000,
    },
    removeOnComplete: false,
    removeOnFail: false,
  };
}

function defaultValidationRunnerJobOptions(): JobsOptions {
  return {
    attempts: 1,
    removeOnComplete: false,
    removeOnFail: false,
  };
}

function defaultPiRunnerJobOptions(): JobsOptions {
  return {
    attempts: 1,
    removeOnComplete: false,
    removeOnFail: false,
  };
}

function defaultReproductionValidatorJobOptions(): JobsOptions {
  return {
    attempts: 1,
    removeOnComplete: false,
    removeOnFail: false,
  };
}

function toIso(value: number | undefined): string | null {
  return value ? new Date(value).toISOString() : null;
}
