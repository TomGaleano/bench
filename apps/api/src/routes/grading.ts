import { eq, or } from "drizzle-orm";
import {
  evaluations,
  graderVerdicts,
  planScores,
  plans,
  patches,
  runs,
} from "@pilab/db/schema";
import {
  createGradingExternalQueue,
  createGradingImplementationQueue,
  createGradingPlanQueue,
  createRedisConnection,
  enqueueGradingExternalJob,
  enqueueGradingImplementationJob,
  enqueueGradingPlanJob,
  GRADING_EXTERNAL_QUEUE_NAME,
  GRADING_IMPLEMENTATION_QUEUE_NAME,
  GRADING_PLAN_QUEUE_NAME,
} from "@pilab/jobs";
import type { FastifyPluginAsync } from "fastify";

type PlanGradingRequest = {
  runId: string;
  judgeModelId?: string;
};

type ImplementationGradingRequest = {
  runId: string;
  judgeModelId?: string;
};

type ExternalGradingRequest = {
  runAId: string;
  runBId: string;
  judgeModelId?: string;
};

type GradingJobReply = {
  jobId: string;
  queueName: string;
  state: string;
  enqueuedAt: string;
};

type RunScoresReply = {
  runId: string;
  planScores: Array<{
    id: string;
    planId: string;
    overallScore: string;
    correctnessScore: number | null;
    completenessScore: number | null;
    safetyScore: number | null;
    rationale: string | null;
    createdAt: string;
  }>;
  implementationScores: Array<{
    id: string;
    evaluationId: string;
    runId: string;
    status: string;
    resolved: boolean;
    failToPassPassed: number;
    failToPassTotal: number;
    passToPassPassed: number;
    passToPassTotal: number;
    diffSimilarityScore: string | null;
    createdAt: string;
  }>;
  externalComparisons: Array<{
    id: string;
    experimentId: string | null;
    runAId: string;
    runBId: string;
    winnerRunId: string | null;
    reasoning: string | null;
    createdAt: string;
  }>;
};

type JobSummary = {
  id: string;
  name: string;
  queueName: string;
  state: string;
  progress: unknown;
  attemptsMade: number;
  createdAt: string | null;
  processedAt: string | null;
  finishedAt: string | null;
  failedReason?: string;
  returnvalue?: unknown;
  data: unknown;
};

type GradingJob = {
  id?: string;
  name: string;
  queueName: string;
  getState: () => Promise<string>;
  progress: unknown;
  attemptsMade: number;
  timestamp: number;
  processedOn?: number;
  finishedOn?: number;
  failedReason?: string;
  returnvalue?: unknown;
  data: unknown;
};

function toIso(value: number | undefined): string | null {
  return value ? new Date(value).toISOString() : null;
}

async function getJobSummary(job: GradingJob): Promise<JobSummary> {
  const state = await job.getState();
  const id = job.id ?? "unknown";

  const summary: JobSummary = {
    id,
    name: job.name,
    queueName: job.queueName,
    state,
    progress: job.progress,
    attemptsMade: job.attemptsMade,
    createdAt: toIso(job.timestamp),
    processedAt: toIso(job.processedOn),
    finishedAt: toIso(job.finishedOn),
    data: job.data,
  };

  if (job.failedReason) {
    summary.failedReason = job.failedReason;
  }

  if (job.returnvalue !== undefined) {
    summary.returnvalue = job.returnvalue;
  }

  return summary;
}

export const gradingRoutes: FastifyPluginAsync = async (fastify) => {
  const redisUrl = process.env.REDIS_URL ?? "redis://localhost:56380";
  const connection = createRedisConnection(redisUrl, {
    maxRetriesPerRequest: null,
  });

  const gradingPlanQueue = createGradingPlanQueue(connection);
  const gradingImplementationQueue = createGradingImplementationQueue(connection);
  const gradingExternalQueue = createGradingExternalQueue(connection);

  fastify.addHook("onClose", async () => {
    await gradingPlanQueue.close();
    await gradingImplementationQueue.close();
    await gradingExternalQueue.close();
    await connection.quit();
  });

  // POST /grading/plan — Enqueue a plan grading job
  fastify.post<{ Body: PlanGradingRequest; Reply: GradingJobReply }>(
    "/grading/plan",
    {
      schema: {
        body: {
          type: "object",
          required: ["runId"],
          additionalProperties: false,
          properties: {
            runId: { type: "string", format: "uuid" },
            judgeModelId: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      const [run] = await fastify.db
        .select()
        .from(runs)
        .where(eq(runs.id, request.body.runId))
        .limit(1);

      if (!run) {
        reply.code(404);
        throw new Error(`Run not found: ${request.body.runId}`);
      }

      const [plan] = await fastify.db
        .select()
        .from(plans)
        .where(eq(plans.runId, request.body.runId))
        .limit(1);

      if (!plan) {
        reply.code(400);
        throw new Error(`Run has no plan: ${request.body.runId}`);
      }

      const planJobData = {
        runId: request.body.runId,
        planId: plan.id,
        caseVersionId: run.caseVersionId ?? "",
      };
      const job = await enqueueGradingPlanJob(
        gradingPlanQueue,
        request.body.judgeModelId !== undefined
          ? { ...planJobData, judgeModelId: request.body.judgeModelId }
          : planJobData,
      );

      const state = await job.getState();

      reply.code(202);
      return {
        jobId: job.id ?? "unknown",
        queueName: GRADING_PLAN_QUEUE_NAME,
        state,
        enqueuedAt: new Date().toISOString(),
      };
    },
  );

  // POST /grading/implementation — Enqueue an implementation grading job
  fastify.post<{ Body: ImplementationGradingRequest; Reply: GradingJobReply }>(
    "/grading/implementation",
    {
      schema: {
        body: {
          type: "object",
          required: ["runId"],
          additionalProperties: false,
          properties: {
            runId: { type: "string", format: "uuid" },
            judgeModelId: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      const [run] = await fastify.db
        .select()
        .from(runs)
        .where(eq(runs.id, request.body.runId))
        .limit(1);

      if (!run) {
        reply.code(404);
        throw new Error(`Run not found: ${request.body.runId}`);
      }

      const [patch] = await fastify.db
        .select()
        .from(patches)
        .where(eq(patches.runId, request.body.runId))
        .limit(1);

      if (!patch) {
        reply.code(400);
        throw new Error(`Run has no patch: ${request.body.runId}`);
      }

      const implJobData = {
        runId: request.body.runId,
        patchId: patch.id,
        caseVersionId: run.caseVersionId ?? "",
      };
      const job = await enqueueGradingImplementationJob(
        gradingImplementationQueue,
        request.body.judgeModelId !== undefined
          ? { ...implJobData, judgeModelId: request.body.judgeModelId }
          : implJobData,
      );

      const state = await job.getState();

      reply.code(202);
      return {
        jobId: job.id ?? "unknown",
        queueName: GRADING_IMPLEMENTATION_QUEUE_NAME,
        state,
        enqueuedAt: new Date().toISOString(),
      };
    },
  );

  // POST /grading/external — Enqueue an external grader comparison job
  fastify.post<{ Body: ExternalGradingRequest; Reply: GradingJobReply }>(
    "/grading/external",
    {
      schema: {
        body: {
          type: "object",
          required: ["runAId", "runBId"],
          additionalProperties: false,
          properties: {
            runAId: { type: "string", format: "uuid" },
            runBId: { type: "string", format: "uuid" },
            judgeModelId: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      if (request.body.runAId === request.body.runBId) {
        reply.code(400);
        throw new Error("runAId and runBId must be distinct");
      }

      const [runA] = await fastify.db
        .select()
        .from(runs)
        .where(eq(runs.id, request.body.runAId))
        .limit(1);

      if (!runA) {
        reply.code(404);
        throw new Error(`Run A not found: ${request.body.runAId}`);
      }

      const [runB] = await fastify.db
        .select()
        .from(runs)
        .where(eq(runs.id, request.body.runBId))
        .limit(1);

      if (!runB) {
        reply.code(404);
        throw new Error(`Run B not found: ${request.body.runBId}`);
      }

      if (!runA.experimentId || !runB.experimentId) {
        reply.code(400);
        throw new Error(
          "Both runs must belong to an experiment for external comparison",
        );
      }

      if (runA.experimentId !== runB.experimentId) {
        reply.code(400);
        throw new Error(
          "Both runs must belong to the same experiment for external comparison",
        );
      }

      const externalJobData = {
        experimentId: runA.experimentId,
        runAId: request.body.runAId,
        runBId: request.body.runBId,
      };
      const job = await enqueueGradingExternalJob(
        gradingExternalQueue,
        request.body.judgeModelId !== undefined
          ? { ...externalJobData, judgeModelId: request.body.judgeModelId }
          : externalJobData,
      );

      const state = await job.getState();

      reply.code(202);
      return {
        jobId: job.id ?? "unknown",
        queueName: GRADING_EXTERNAL_QUEUE_NAME,
        state,
        enqueuedAt: new Date().toISOString(),
      };
    },
  );

  // GET /grading/:runId/scores — Get all scores for a run
  fastify.get<{ Params: { runId: string }; Reply: RunScoresReply }>(
    "/grading/:runId/scores",
    {
      schema: {
        params: {
          type: "object",
          required: ["runId"],
          properties: {
            runId: { type: "string", format: "uuid" },
          },
        },
      },
    },
    async (request, reply) => {
      const runId = request.params.runId;

      const [run] = await fastify.db
        .select()
        .from(runs)
        .where(eq(runs.id, runId))
        .limit(1);

      if (!run) {
        reply.code(404);
        throw new Error(`Run not found: ${runId}`);
      }

      const planScoreRows = await fastify.db
        .select({
          id: planScores.id,
          planId: planScores.planId,
          overallScore: planScores.overallScore,
          correctnessScore: planScores.correctnessScore,
          completenessScore: planScores.completenessScore,
          safetyScore: planScores.safetyScore,
          rationale: planScores.rationale,
          createdAt: planScores.createdAt,
        })
        .from(planScores)
        .innerJoin(plans, eq(plans.id, planScores.planId))
        .where(eq(plans.runId, runId));

      const evaluationRows = await fastify.db
        .select()
        .from(evaluations)
        .where(eq(evaluations.runId, runId));

      const verdictRows = await fastify.db
        .select()
        .from(graderVerdicts)
        .where(
          or(
            eq(graderVerdicts.runAId, runId),
            eq(graderVerdicts.runBId, runId),
          ),
        );

      reply.code(200);
      return {
        runId,
        planScores: planScoreRows.map((row) => ({
          id: row.id,
          planId: row.planId,
          overallScore: row.overallScore,
          correctnessScore: row.correctnessScore,
          completenessScore: row.completenessScore,
          safetyScore: row.safetyScore,
          rationale: row.rationale,
          createdAt: row.createdAt.toISOString(),
        })),
        implementationScores: evaluationRows.map((row) => ({
          id: row.id,
          evaluationId: row.id,
          runId: row.runId ?? "",
          status: row.status,
          resolved: row.resolved,
          failToPassPassed: row.failToPassPassed,
          failToPassTotal: row.failToPassTotal,
          passToPassPassed: row.passToPassPassed,
          passToPassTotal: row.passToPassTotal,
          diffSimilarityScore: row.diffSimilarityScore,
          createdAt: row.createdAt.toISOString(),
        })),
        externalComparisons: verdictRows.map((row) => ({
          id: row.id,
          experimentId: row.experimentId,
          runAId: row.runAId,
          runBId: row.runBId,
          winnerRunId: row.winnerRunId,
          reasoning: row.reasoning,
          createdAt: row.createdAt.toISOString(),
        })),
      };
    },
  );

  // GET /grading/jobs/:jobId — Return BullMQ job status for any grading job
  fastify.get<{ Params: { jobId: string }; Reply: JobSummary }>(
    "/grading/jobs/:jobId",
    {
      schema: {
        params: {
          type: "object",
          required: ["jobId"],
          properties: {
            jobId: { type: "string", minLength: 1 },
          },
        },
      },
    },
    async (request, reply) => {
      const jobId = request.params.jobId;

      const [planJob, implJob, externalJob] = await Promise.all([
        gradingPlanQueue.getJob(jobId),
        gradingImplementationQueue.getJob(jobId),
        gradingExternalQueue.getJob(jobId),
      ]);

      const job = planJob ?? implJob ?? externalJob;

      if (!job) {
        reply.code(404);
        throw new Error(`Grading job not found: ${jobId}`);
      }

      reply.code(200);
      return getJobSummary(job);
    },
  );
};
