import { asc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  agentConfigs,
  artifacts,
  caseVersions,
  githubIssues,
  harnessVersions,
  plans,
  runEvents,
  runs,
} from "@pilab/db/schema";
import type { DbClient } from "@pilab/db";
import {
  createPiRunnerImplJobId,
  createPiRunnerPlanJobId,
  createPiRunnerQueue,
  createRedisConnection,
  enqueuePiRunnerImplJob,
  enqueuePiRunnerPlanJob,
  getPiRunnerJobSummary,
} from "@pilab/jobs";
import type { FastifyPluginAsync } from "fastify";
import type { RunEventRequest } from "../types.js";
import type { RunEventBus } from "../event-bus.js";
import { createApiObjectStore } from "../object-store.js";

type RunRoutesOptions = {
  eventBus: RunEventBus;
};

type RunParams = {
  runId: string;
};

type PiPlanRunRequest = {
  caseVersionId: string;
  modelId: string;
  prompt?: string;
  workspacePath?: string;
  maxTurns?: number;
  maxWallClockSeconds?: number;
};

type PiImplRunRequest = {
  planRunId: string;
  modelId: string;
  maxTurns?: number;
  maxWallClockSeconds?: number;
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
  piRunnerJob?: PublicPiRunnerJobSummary | null;
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

type PublicPiRunnerJobSummary = {
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
  GRADING_EXTERNAL_QUEUE_NAME,
  GRADING_IMPLEMENTATION_QUEUE_NAME,
  GRADING_PLAN_QUEUE_NAME,
} from "@pilab/jobs";

export const runRoutes: FastifyPluginAsync<RunRoutesOptions> = async (
  fastify,
  options,
) => {
  const redisUrl = process.env.REDIS_URL ?? "redis://localhost:56380";
  const connection = createRedisConnection(redisUrl, {
    maxRetriesPerRequest: null,
  });
  const piRunnerQueue = createPiRunnerQueue({ connection });
  const gradingPlanQueue = createGradingPlanQueue(connection);
  const gradingImplementationQueue = createGradingImplementationQueue(connection);
  const gradingExternalQueue = createGradingExternalQueue(connection);

  fastify.addHook("onClose", async () => {
    await piRunnerQueue.close();
    await gradingPlanQueue.close();
    await gradingImplementationQueue.close();
    await gradingExternalQueue.close();
    await connection.quit();
  });

  fastify.post<{ Body: PiPlanRunRequest; Reply: RunSummary }>(
    "/runs/pi/plan",
    {
      schema: {
        body: {
          type: "object",
          required: ["caseVersionId", "modelId"],
          additionalProperties: false,
          properties: {
            caseVersionId: { type: "string", format: "uuid" },
            modelId: { type: "string", minLength: 1 },
            prompt: { type: "string" },
            workspacePath: { type: "string" },
            maxTurns: { type: "integer", minimum: 1, maximum: 50 },
            maxWallClockSeconds: { type: "integer", minimum: 5, maximum: 3600 },
          },
        },
      },
    },
    async (request, reply) => {
      const [caseVersion] = await fastify.db
        .select()
        .from(caseVersions)
        .where(eq(caseVersions.id, request.body.caseVersionId))
        .limit(1);

      if (!caseVersion) {
        reply.code(404);
        throw new Error(`Case version not found: ${request.body.caseVersionId}`);
      }

      const harnessVersionId = await ensureHarnessVersion(fastify.db);
      const agentConfigId = await createPlanAgentConfig(fastify.db, {
        harnessVersionId,
        modelId: request.body.modelId,
      });
      const [run] = await fastify.db
        .insert(runs)
        .values({
          caseVersionId: request.body.caseVersionId,
          agentConfigId,
          harnessVersionId,
          mode: "plan_only",
          status: "queued",
          openRouterModelId: request.body.modelId,
          providerRoutingConfig: {},
          fallbackPolicy: { enabled: false },
        })
        .returning();

      if (!run) {
        throw new Error("Failed to create Pi plan run");
      }

      const { issueTitle, issueBody } = await loadIssueContent(
        fastify.db,
        request.body.caseVersionId,
      );

      const prompt =
        request.body.prompt ??
        buildDefaultPlanPrompt({
          caseVersionId: request.body.caseVersionId,
          version: caseVersion.version,
          issueTitle,
          issueBody,
        });

      await enqueuePiRunnerPlanJob(piRunnerQueue, {
        runId: run.id,
        caseVersionId: request.body.caseVersionId,
        workspacePath:
          request.body.workspacePath ?? process.env.PI_RUNNER_WORKSPACE_PATH ?? process.cwd(),
        modelId: request.body.modelId,
        prompt,
        maxTurns: request.body.maxTurns ?? 8,
        maxWallClockSeconds: request.body.maxWallClockSeconds ?? 300,
        enqueuedAt: new Date().toISOString(),
      });

      await appendLegacyEvent(options, run.id, {
        type: "queued",
        message: "Pi plan run queued",
        payload: { jobId: createPiRunnerPlanJobId(run.id) },
      });

      const summary = await getRunSummary(fastify.db, piRunnerQueue, gradingPlanQueue, gradingImplementationQueue, gradingExternalQueue, run.id);
      if (!summary) {
        throw new Error(`Run disappeared after creation: ${run.id}`);
      }

      reply.code(202);
      return summary;
    },
  );

  fastify.post<{ Body: PiImplRunRequest; Reply: RunSummary }>(
    "/runs/pi/impl",
    {
      schema: {
        body: {
          type: "object",
          required: ["planRunId", "modelId"],
          additionalProperties: false,
          properties: {
            planRunId: { type: "string", format: "uuid" },
            modelId: { type: "string", minLength: 1 },
            maxTurns: { type: "integer", minimum: 1, maximum: 50 },
            maxWallClockSeconds: { type: "integer", minimum: 5, maximum: 3600 },
          },
        },
      },
    },
    async (request, reply) => {
      const [planRun] = await fastify.db
        .select()
        .from(runs)
        .where(eq(runs.id, request.body.planRunId))
        .limit(1);

      if (!planRun) {
        reply.code(404);
        throw new Error(`Plan run not found: ${request.body.planRunId}`);
      }

      if (planRun.status !== "succeeded") {
        reply.code(400);
        throw new Error(
          `Plan run is not completed: ${request.body.planRunId} (status: ${planRun.status})`,
        );
      }

      if (!planRun.caseVersionId) {
        reply.code(400);
        throw new Error(`Plan run has no caseVersionId: ${request.body.planRunId}`);
      }

      const [plan] = await fastify.db
        .select()
        .from(plans)
        .where(eq(plans.runId, request.body.planRunId))
        .limit(1);

      if (!plan?.rawArtifactId) {
        reply.code(400);
        throw new Error(`No completed plan found for run: ${request.body.planRunId}`);
      }

      const harnessVersionId = await ensureHarnessVersion(fastify.db);
      const agentConfigId = await createImplAgentConfig(fastify.db, {
        harnessVersionId,
        modelId: request.body.modelId,
      });

      const [run] = await fastify.db
        .insert(runs)
        .values({
          parentRunId: request.body.planRunId,
          experimentId: planRun.experimentId,
          caseVersionId: planRun.caseVersionId,
          agentConfigId,
          harnessVersionId,
          mode: "implementation_only",
          status: "queued",
          openRouterModelId: request.body.modelId,
          providerRoutingConfig: {},
          fallbackPolicy: { enabled: false },
        })
        .returning();

      if (!run) {
        throw new Error("Failed to create Pi impl run");
      }

      const jobData: import("@pilab/jobs").PiRunnerImplJobData = {
        runId: run.id,
        caseVersionId: planRun.caseVersionId,
        planRunId: request.body.planRunId,
        planArtifactId: plan.rawArtifactId,
        modelId: request.body.modelId,
      };
      if (request.body.maxTurns !== undefined) {
        jobData.maxTurns = request.body.maxTurns;
      }
      if (request.body.maxWallClockSeconds !== undefined) {
        jobData.maxWallClockSeconds = request.body.maxWallClockSeconds;
      }
      await enqueuePiRunnerImplJob(piRunnerQueue, jobData);

      await appendLegacyEvent(options, run.id, {
        type: "queued",
        message: "Pi impl run queued",
        payload: { jobId: createPiRunnerImplJobId(run.id) },
      });

      const summary = await getRunSummary(fastify.db, piRunnerQueue, gradingPlanQueue, gradingImplementationQueue, gradingExternalQueue, run.id);
      if (!summary) {
        throw new Error(`Run disappeared after creation: ${run.id}`);
      }

      reply.code(202);
      return summary;
    },
  );

  fastify.get<{ Reply: RunSummary[] }>("/runs", async () => {
    const rows = await fastify.db
      .select({ id: runs.id })
      .from(runs)
      .orderBy(asc(runs.createdAt));
    const summaries = await Promise.all(
      rows.slice(-25).reverse().map((row) => getRunSummary(fastify.db, piRunnerQueue, gradingPlanQueue, gradingImplementationQueue, gradingExternalQueue, row.id)),
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
      const summary = await getRunSummary(fastify.db, piRunnerQueue, gradingPlanQueue, gradingImplementationQueue, gradingExternalQueue, request.params.runId);

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

async function ensureHarnessVersion(db: Parameters<typeof getRunSummary>[0]) {
  const [existing] = await db
    .select()
    .from(harnessVersions)
    .where(eq(harnessVersions.harness, "pi"))
    .limit(1);

  if (existing) {
    return existing.id;
  }

  const [created] = await db
    .insert(harnessVersions)
    .values({
      harness: "pi",
      version: "sdk-plan-v1",
      adapterVersion: "pilab.runner-pi.plan.v1",
      metadata: { toolPolicy: "read_only" },
    })
    .returning();

  if (!created) {
    throw new Error("Failed to create Pi harness version");
  }

  return created.id;
}

async function createPlanAgentConfig(
  db: Parameters<typeof getRunSummary>[0],
  input: { harnessVersionId: string; modelId: string },
) {
  const [created] = await db
    .insert(agentConfigs)
    .values({
      name: `Pi plan-only ${input.modelId}`,
      mode: "plan_only",
      harnessVersionId: input.harnessVersionId,
      toolPolicy: { tools: ["read", "grep", "find", "ls"], mutation: "blocked" },
      modelSettings: { modelId: input.modelId },
    })
    .returning();

  if (!created) {
    throw new Error("Failed to create Pi plan agent config");
  }

  return created.id;
}

async function createImplAgentConfig(
  db: Parameters<typeof getRunSummary>[0],
  input: { harnessVersionId: string; modelId: string },
) {
  const [created] = await db
    .insert(agentConfigs)
    .values({
      name: `Pi implementation-only ${input.modelId}`,
      mode: "implementation_only",
      harnessVersionId: input.harnessVersionId,
      toolPolicy: { tools: ["read", "write", "edit", "grep", "find", "ls", "bash"], mutation: "allowed" },
      modelSettings: { modelId: input.modelId },
    })
    .returning();

  if (!created) {
    throw new Error("Failed to create Pi impl agent config");
  }

  return created.id;
}

async function getRunSummary(
  db: import("@pilab/db").DbClient,
  queue: ReturnType<typeof createPiRunnerQueue>,
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
    piRunnerJob: toPublicPiRunnerJob(
      await getPiRunnerJobSummary(
        queue,
        run.mode === "implementation_only"
          ? createPiRunnerImplJobId(run.id)
          : createPiRunnerPlanJobId(run.id),
      ),
    ),
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
    // This is handled separately in the external grading endpoint
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

function toPublicPiRunnerJob(
  summary: Awaited<ReturnType<typeof getPiRunnerJobSummary>>,
): PublicPiRunnerJobSummary | null {
  if (!summary) {
    return null;
  }

  return {
    id: summary.id,
    name: summary.name,
    queueName: summary.queueName,
    state: summary.state,
    progress: summary.progress,
    attemptsMade: summary.attemptsMade,
    createdAt: summary.createdAt,
    processedAt: summary.processedAt,
    finishedAt: summary.finishedAt,
    ...(summary.failedReason ? { failedReason: summary.failedReason } : {}),
    ...(summary.returnvalue ? { returnvalue: summary.returnvalue } : {}),
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

function buildDefaultPlanPrompt(input: {
  caseVersionId: string;
  version: number;
  issueTitle: string;
  issueBody: string;
}) {
  const issueSection =
    input.issueTitle
      ? `\n\n## GitHub Issue: ${input.issueTitle}\n\n${input.issueBody || ""}`
      : "";

  return [
    "You are running a Pi Lab plan-only benchmark.",
    `Case version: ${input.caseVersionId} v${input.version}.${issueSection}`,
    "Inspect the repository context with read-only tools and produce a concise implementation plan.",
    "Do not create, edit, delete, move, stage, commit, or patch files.",
  ].join("\n");
}

async function loadIssueContent(
  db: DbClient,
  caseVersionId: string,
): Promise<{ issueTitle: string; issueBody: string }> {
  const [cv] = await db
    .select({
      githubIssueId: caseVersions.githubIssueId,
      issueArtifactId: caseVersions.issueArtifactId,
    })
    .from(caseVersions)
    .where(eq(caseVersions.id, caseVersionId))
    .limit(1);

  if (!cv?.githubIssueId) {
    return { issueTitle: "", issueBody: "" };
  }

  const [issue] = await db
    .select({ title: githubIssues.title, body: githubIssues.body })
    .from(githubIssues)
    .where(eq(githubIssues.id, cv.githubIssueId))
    .limit(1);

  const title = issue?.title ?? "";
  let body = issue?.body ?? "";

  // Fall back to loading from issue artifact if body is empty
  if (!body && cv.issueArtifactId) {
    try {
      const [artifactRow] = await db
        .select({ objectKey: artifacts.objectKey })
        .from(artifacts)
        .where(eq(artifacts.id, cv.issueArtifactId))
        .limit(1);

      if (artifactRow?.objectKey) {
        const objectStore = createApiObjectStore();
        const issueData = await objectStore.getJsonArtifact<{
          issue?: { title?: string; body?: string };
        }>(artifactRow.objectKey);
        const issueObj = issueData?.issue;
        if (issueObj) {
          if (typeof issueObj.body === "string") {
            body = issueObj.body;
          }
        }
      }
    } catch {
      // Ignore artifact load failures
    }
  }

  return { issueTitle: title, issueBody: body };
}
