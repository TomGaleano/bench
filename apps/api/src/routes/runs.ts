import { asc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  artifacts,
  plans,
  runEvents,
  runs,
} from "@pilab/db/schema";
import { createRedisConnection } from "@pilab/jobs";
import type { FastifyPluginAsync } from "fastify";
import type { RunEventRequest } from "../types.js";
import type { RunEventBus } from "../event-bus.js";

type RunRoutesOptions = {
  eventBus: RunEventBus;
};

type RunParams = {
  runId: string;
};

type RunSummary = {
  id: string;
  caseVersionId: string | null;
  mode: string;
  status: string;
  modelId: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  error?: unknown;
  plan?: {
    id: string;
    markdown: string | null;
    artifact: ArtifactSummary | null;
  } | null;
  eventCount: number;
  gradingStatus: {
    plan?: { jobId: string; state: string } | null;
    implementation?: { jobId: string; state: string } | null;
    external?: { jobId: string; state: string } | null;
  };
};

type ArtifactSummary = {
  id: string;
  kind: string;
  objectKey: string;
  byteSize: number | null;
  contentType: string | null;
};

type DurableRunEvent = {
  id: string;
  runId: string;
  seq: number;
  timestamp: string;
  stage: string;
  kind: string;
  payload: unknown;
};

import {
  createGradingExternalQueue,
  createGradingImplementationQueue,
  createGradingPlanQueue,
} from "@pilab/jobs";

export const runRoutes: FastifyPluginAsync<RunRoutesOptions> = async (
  fastify,
  options,
) => {
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

  fastify.get<{ Reply: RunSummary[] }>("/runs", async () => {
    const rows = await fastify.db
      .select({ id: runs.id })
      .from(runs)
      .orderBy(asc(runs.createdAt));
    const summaries = await Promise.all(
      rows.slice(-25).reverse().map((row) => getRunSummary(fastify.db, gradingPlanQueue, gradingImplementationQueue, gradingExternalQueue, row.id)),
    );

    return summaries.filter((summary): summary is RunSummary => Boolean(summary));
  });

  fastify.get<{ Params: RunParams; Reply: RunSummary }>(
    "/runs/:runId",
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
      const summary = await getRunSummary(fastify.db, gradingPlanQueue, gradingImplementationQueue, gradingExternalQueue, request.params.runId);

      if (!summary) {
        reply.code(404);
        throw new Error(`Run not found: ${request.params.runId}`);
      }

      return summary;
    },
  );

  fastify.get<{ Params: RunParams; Reply: DurableRunEvent[] }>(
    "/runs/:runId/events",
    async (request) => getDurableRunEvents(fastify.db, request.params.runId),
  );

  fastify.post<{ Params: RunParams; Body: RunEventRequest }>(
    "/runs/:runId/events",
    async (request, reply) => {
      await appendLegacyEvent(options, request.params.runId, request.body);
      reply.code(202);
      return {
        id: `evt_${randomUUID()}`,
        runId: request.params.runId,
        ...request.body,
        receivedAt: new Date().toISOString(),
      };
    },
  );

  fastify.get<{ Params: RunParams }>(
    "/runs/:runId/stream",
    { websocket: true },
    async (socket, request) => {
      const runId = request.params.runId;
      const replayEvents = await getDurableRunEvents(fastify.db, runId);

      socket.send(
        JSON.stringify({
          type: "connected",
          runId,
          time: new Date().toISOString(),
        }),
      );

      for (const event of replayEvents) {
        socket.send(JSON.stringify({ type: "run.event", event, replay: true }));
      }

      const unsubscribe = options.eventBus.subscribe(runId, (event) => {
        socket.send(JSON.stringify({ type: "run.event", event }));
      });

      socket.on("close", unsubscribe);
      socket.on("error", (error) => {
        request.log.warn({ error, runId }, "run stream socket error");
        unsubscribe();
      });
    },
  );
};

async function getRunSummary(
  db: import("@pilab/db").DbClient,
  gradingPlanQueue: ReturnType<typeof createGradingPlanQueue>,
  gradingImplementationQueue: ReturnType<typeof createGradingImplementationQueue>,
  gradingExternalQueue: ReturnType<typeof createGradingExternalQueue>,
  runId: string,
): Promise<RunSummary | null> {
  const [run] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);

  if (!run) {
    return null;
  }

  const durableEvents = await getDurableRunEvents(db, runId);
  const [plan] = await db.select().from(plans).where(eq(plans.runId, runId)).limit(1);
  let artifact: ArtifactSummary | null = null;

  if (plan?.rawArtifactId) {
    const [artifactRow] = await db
      .select()
      .from(artifacts)
      .where(eq(artifacts.id, plan.rawArtifactId))
      .limit(1);
    artifact = artifactRow ? summarizeArtifact(artifactRow) : null;
  }

  // Query grading job status
  const gradingStatus = await getGradingJobStatus(
    gradingPlanQueue,
    gradingImplementationQueue,
    gradingExternalQueue,
    runId,
  );

  return {
    id: run.id,
    caseVersionId: run.caseVersionId,
    mode: run.mode,
    status: run.status,
    modelId: run.openRouterModelId,
    createdAt: run.createdAt.toISOString(),
    startedAt: run.startedAt?.toISOString() ?? null,
    finishedAt: run.finishedAt?.toISOString() ?? null,
    ...(run.error ? { error: run.error } : {}),
    plan: plan
      ? {
          id: plan.id,
          markdown: plan.planMarkdown,
          artifact,
        }
      : null,
    eventCount: durableEvents.length,
    gradingStatus,
  };
}

async function getGradingJobStatus(
  gradingPlanQueue: ReturnType<typeof createGradingPlanQueue>,
  gradingImplementationQueue: ReturnType<typeof createGradingImplementationQueue>,
  gradingExternalQueue: ReturnType<typeof createGradingExternalQueue>,
  runId: string,
): Promise<{
  plan?: { jobId: string; state: string } | null;
  implementation?: { jobId: string; state: string } | null;
  external?: { jobId: string; state: string } | null;
}> {
  const gradingStatus: {
    plan?: { jobId: string; state: string } | null;
    implementation?: { jobId: string; state: string } | null;
    external?: { jobId: string; state: string } | null;
  } = {};

  try {
    const planJobId = `grading-plan-${runId}`;
    const planJob = await gradingPlanQueue.getJob(planJobId);
    if (planJob) {
      const state = await planJob.getState();
      gradingStatus.plan = { jobId: planJobId, state };
    } else {
      gradingStatus.plan = null;
    }
  } catch (error) {
    gradingStatus.plan = null;
  }

  try {
    const implJobId = `grading-implementation-${runId}`;
    const implJob = await gradingImplementationQueue.getJob(implJobId);
    if (implJob) {
      const state = await implJob.getState();
      gradingStatus.implementation = { jobId: implJobId, state };
    } else {
      gradingStatus.implementation = null;
    }
  } catch (error) {
    gradingStatus.implementation = null;
  }

  try {
    // External grading involves pairs of runs, so we can't easily query by single runId
    gradingStatus.external = null;
  } catch (error) {
    gradingStatus.external = null;
  }

  return {
    plan: gradingStatus.plan ?? null,
    implementation: gradingStatus.implementation ?? null,
    external: gradingStatus.external ?? null,
  };
}

async function getDurableRunEvents(
  db: import("@pilab/db").DbClient,
  runId: string,
): Promise<DurableRunEvent[]> {
  const rows = await db
    .select()
    .from(runEvents)
    .where(eq(runEvents.runId, runId))
    .orderBy(asc(runEvents.seq));

  return rows.map((row) => ({
    id: row.id,
    runId: row.runId,
    seq: row.seq,
    timestamp: row.ts.toISOString(),
    stage: row.stage,
    kind: row.kind,
    payload: row.payload,
  }));
}

function summarizeArtifact(row: typeof artifacts.$inferSelect): ArtifactSummary {
  return {
    id: row.id,
    kind: row.kind,
    objectKey: row.objectKey,
    byteSize: row.byteSize,
    contentType: row.contentType,
  };
}

async function appendLegacyEvent(
  options: RunRoutesOptions,
  runId: string,
  event: RunEventRequest,
) {
  options.eventBus.publish({
    id: `evt_${randomUUID()}`,
    runId,
    ...event,
    receivedAt: new Date().toISOString(),
  });
}
