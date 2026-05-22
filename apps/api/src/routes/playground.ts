import { and, arrayOverlaps, asc, eq, desc, gte, inArray, lte, or, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  playgroundSessions,
  playgroundAgentRuns,
  playgroundEvents,
  playgroundAutograderRuns,
  playgroundAutograderScores,
} from "@pilab/db/schema";
import {
  createPlaygroundQueue,
  createRedisConnection,
  enqueuePlaygroundSessionJob,
  publishPlaygroundCancelRun,
  publishPlaygroundFollowUp,
  publishPlaygroundRelease,
  type PlaygroundSandboxImage,
} from "@pilab/jobs";
import type { FastifyPluginAsync } from "fastify";
import type { RunEventBus } from "../event-bus.js";

type PlaygroundRoutesOptions = {
  eventBus: RunEventBus;
};

type StartPlaygroundRequest = {
  prompt: string;
  models: Array<{ id: string; name: string }>;
  graderModelId?: string;
  maxWallClockSeconds?: number;
  maxOutputTokensPerAgent?: number;
  tools?: string[];
  sandboxImage?: PlaygroundSandboxImage;
  seedPromptText?: string;
  runTwiceAndAverage?: boolean;
};

const DEFAULT_MAX_WALL_CLOCK_SECONDS = 600;
const DEFAULT_MAX_OUTPUT_TOKENS = 32_000;
const MIN_WALL_CLOCK_SECONDS = 60;
const MAX_WALL_CLOCK_SECONDS = 1800;
const MIN_OUTPUT_TOKENS = 4_000;
const MAX_OUTPUT_TOKENS = 128_000;
const VALID_SANDBOX_IMAGES: PlaygroundSandboxImage[] = ["py", "node", "py-node"];
const VALID_TOOLS = new Set([
  "read",
  "write",
  "edit",
  "grep",
  "find",
  "ls",
  "bash",
  "network",
]);

function clampInt(value: number | undefined, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.trunc(value), min), max);
}

function sanitizeTools(tools: string[] | undefined): string[] | undefined {
  if (!Array.isArray(tools)) return undefined;
  const cleaned = tools.filter((t): t is string => typeof t === "string" && VALID_TOOLS.has(t));
  return cleaned.length > 0 ? Array.from(new Set(cleaned)) : undefined;
}

function sanitizeSandboxImage(
  image: PlaygroundSandboxImage | undefined,
): PlaygroundSandboxImage | undefined {
  if (!image) return undefined;
  return VALID_SANDBOX_IMAGES.includes(image) ? image : undefined;
}

type PlaygroundSessionResponse = {
  id: string;
  prompt: string;
  status: string;
  gradingMode: string | null;
  graderModelId: string | null;
  createdAt: string;
  completedAt: string | null;
  saved: boolean;
  title: string | null;
  tags: string[];
  shareToken: string | null;
  agentRuns: Array<{
    id: string;
    modelId: string;
    modelName: string;
    status: string;
    sandboxId: string | null;
    appUrl: string | null;
    output: string | null;
    score: number | null;
    scoreRationale: string | null;
    scoreCorrectness: number | null;
    scoreCodeQuality: number | null;
    scoreUx: number | null;
    scoreShipIt: number | null;
    fileCount: number | null;
    loc: number | null;
    createdAt: string;
    startedAt: string | null;
    finishedAt: string | null;
  }>;
};

type PlaygroundEventResponse = {
  id: string;
  agentRunId: string;
  seq: number;
  timestamp: string;
  kind: string;
  payload: unknown;
};

type AppendEventRequest = {
  agentRunId: string;
  seq: number;
  kind:
    | "status"
    | "assistant_text_delta"
    | "tool_call_started"
    | "tool_call_delta"
    | "tool_call_finished"
    | "port_open"
    | "url_resolved"
    | "error";
  payload?: Record<string, unknown>;
};

type UpdateRunRequest = {
  status?: "queued" | "preparing" | "running" | "succeeded" | "failed";
  sandboxId?: string;
  appUrl?: string;
  output?: string;
  startedAt?: string;
  finishedAt?: string;
  fileCount?: number;
  loc?: number;
};

export const playgroundRoutes: FastifyPluginAsync<PlaygroundRoutesOptions> = async (
  fastify,
  options,
) => {
  const redisUrl = process.env.REDIS_URL ?? "redis://localhost:56380";
  const connection = createRedisConnection(redisUrl, {
    maxRetriesPerRequest: null,
  });
  const playgroundQueue = createPlaygroundQueue({ connection });

  fastify.addHook("onClose", async () => {
    await playgroundQueue.close();
    await connection.quit();
  });

  // POST /playground/start — create session + agent runs, enqueue jobs
  fastify.post<{ Body: StartPlaygroundRequest; Reply: PlaygroundSessionResponse }>(
    "/playground/start",
    {
      schema: {
        body: {
          type: "object",
          required: ["prompt", "models"],
          properties: {
            prompt: { type: "string", minLength: 1, maxLength: 4000 },
            models: {
              type: "array",
              minItems: 2,
              maxItems: 5,
              items: {
                type: "object",
                required: ["id", "name"],
                properties: {
                  id: { type: "string" },
                  name: { type: "string" },
                },
              },
            },
            graderModelId: { type: "string" },
            maxWallClockSeconds: { type: "integer" },
            maxOutputTokensPerAgent: { type: "integer" },
            tools: { type: "array", items: { type: "string" } },
            sandboxImage: { type: "string" },
            seedPromptText: { type: "string", maxLength: 8000 },
            runTwiceAndAverage: { type: "boolean" },
          },
        },
      },
    },
    async (request, reply) => {
      const {
        prompt,
        models,
        graderModelId,
        maxWallClockSeconds,
        maxOutputTokensPerAgent,
        tools,
        sandboxImage,
        seedPromptText,
        runTwiceAndAverage,
      } = request.body;

      const wallClock = clampInt(
        maxWallClockSeconds,
        MIN_WALL_CLOCK_SECONDS,
        MAX_WALL_CLOCK_SECONDS,
        DEFAULT_MAX_WALL_CLOCK_SECONDS,
      );
      const outputCap = clampInt(
        maxOutputTokensPerAgent,
        MIN_OUTPUT_TOKENS,
        MAX_OUTPUT_TOKENS,
        DEFAULT_MAX_OUTPUT_TOKENS,
      );
      const cleanedTools = sanitizeTools(tools);
      const cleanedImage = sanitizeSandboxImage(sandboxImage);
      const cleanedSeed = typeof seedPromptText === "string" && seedPromptText.trim().length > 0
        ? seedPromptText
        : null;
      const doubleRun = runTwiceAndAverage === true;

      const [session] = await fastify.db
        .insert(playgroundSessions)
        .values({
          prompt,
          status: "running",
          gradingMode: graderModelId ? "auto" : null,
          graderModelId: graderModelId ?? null,
          maxWallClockSeconds: wallClock,
          maxOutputTokensPerAgent: outputCap,
          tools: cleanedTools ?? null,
          sandboxImage: cleanedImage ?? null,
          seedPromptText: cleanedSeed,
          runTwiceAndAverage: doubleRun,
        })
        .returning();

      if (!session) {
        throw new Error("Failed to create playground session");
      }

      const insertedRuns: Array<{ agentRunId: string; modelId: string; modelName: string }> = [];
      for (const model of models) {
        const [run] = await fastify.db
          .insert(playgroundAgentRuns)
          .values({
            sessionId: session.id,
            modelId: model.id,
            modelName: model.name,
            status: "queued",
          })
          .returning();

        if (!run) {
          throw new Error(`Failed to create agent run for model ${model.id}`);
        }

        insertedRuns.push({ agentRunId: run.id, modelId: model.id, modelName: model.name });

        options.eventBus.publish({
          id: randomUUID(),
          runId: session.id,
          type: "created",
          message: `Playground agent run queued for ${model.name}`,
          payload: { agentRunId: run.id, modelId: model.id, modelName: model.name },
          receivedAt: new Date().toISOString(),
        });
      }

      // One BullMQ job per session — the worker creates a single sandbox, sets up
      // git worktrees per agent, and runs them in parallel inside that one process.
      await enqueuePlaygroundSessionJob(playgroundQueue, {
        sessionId: session.id,
        prompt,
        agentRuns: insertedRuns,
        maxWallClockSeconds: wallClock,
        maxOutputTokensPerAgent: outputCap,
        ...(cleanedTools ? { tools: cleanedTools } : {}),
        ...(cleanedImage ? { sandboxImage: cleanedImage } : {}),
        ...(cleanedSeed ? { seedPromptText: cleanedSeed } : {}),
        ...(doubleRun ? { runTwiceAndAverage: true } : {}),
      });

      const response = await buildSessionResponse(fastify, session.id);
      if (!response) {
        throw new Error("Session disappeared after creation");
      }

      reply.code(202);
      return response;
    },
  );

  // GET /playground — list sessions with optional filters
  fastify.get<{
    Querystring: {
      model?: string;
      tag?: string;
      starred?: string;
      minScore?: string;
      from?: string;
      to?: string;
      limit?: string;
    };
    Reply: PlaygroundSessionResponse[];
  }>(
    "/playground",
    {
      schema: {
        querystring: {
          type: "object",
          properties: {
            model: { type: "string" },
            tag: { type: "string" },
            starred: { type: "string" },
            minScore: { type: "string" },
            from: { type: "string" },
            to: { type: "string" },
            limit: { type: "string" },
          },
        },
      },
    },
    async (request) => {
      const q = request.query;
      const limit = Math.min(Math.max(Number.parseInt(q.limit ?? "50", 10) || 50, 1), 200);

      const conditions = [];

      if (q.starred === "true") conditions.push(eq(playgroundSessions.saved, true));
      if (q.starred === "false") conditions.push(eq(playgroundSessions.saved, false));
      if (q.from) {
        const d = new Date(q.from);
        if (Number.isFinite(d.getTime())) conditions.push(gte(playgroundSessions.createdAt, d));
      }
      if (q.to) {
        const d = new Date(q.to);
        if (Number.isFinite(d.getTime())) conditions.push(lte(playgroundSessions.createdAt, d));
      }
      if (q.tag) {
        conditions.push(arrayOverlaps(playgroundSessions.tags, [q.tag]));
      }

      let sessionsQuery = fastify.db
        .select()
        .from(playgroundSessions)
        .$dynamic();

      if (conditions.length > 0) {
        sessionsQuery = sessionsQuery.where(and(...conditions));
      }

      const sessions = await sessionsQuery
        .orderBy(desc(playgroundSessions.createdAt))
        .limit(limit);

      // The model and minScore filters touch agent_runs; apply them as a
      // post-filter after we've enriched the rows. Both are rare enough
      // that the extra in-memory pass is fine for ≤200 sessions.
      const enriched = (
        await Promise.all(sessions.map((s) => buildSessionResponse(fastify, s.id)))
      ).filter((r): r is PlaygroundSessionResponse => r !== null);

      const minScoreNum = q.minScore ? Number.parseInt(q.minScore, 10) : null;
      return enriched.filter((s) => {
        if (q.model && !s.agentRuns.some((r) => r.modelId === q.model)) return false;
        if (minScoreNum != null && Number.isFinite(minScoreNum)) {
          const best = s.agentRuns.reduce(
            (acc, r) => (r.score != null && r.score > acc ? r.score : acc),
            -Infinity,
          );
          if (best < minScoreNum) return false;
        }
        return true;
      });
    },
  );

  // GET /playground/saved — list saved sessions
  fastify.get<{ Reply: PlaygroundSessionResponse[] }>(
    "/playground/saved",
    async () => {
      const sessions = await fastify.db
        .select()
        .from(playgroundSessions)
        .where(eq(playgroundSessions.saved, true))
        .orderBy(desc(playgroundSessions.createdAt))
        .limit(50);

      const results = await Promise.all(
        sessions.map((s) => buildSessionResponse(fastify, s.id)),
      );

      return results.filter((r): r is PlaygroundSessionResponse => r !== null);
    },
  );

  // GET /playground/:id — get session with agent runs
  fastify.get<{ Params: { id: string }; Reply: PlaygroundSessionResponse }>(
    "/playground/:id",
    async (request, reply) => {
      const response = await buildSessionResponse(fastify, request.params.id);
      if (!response) {
        reply.code(404);
        throw new Error(`Playground session not found: ${request.params.id}`);
      }
      return response;
    },
  );

  // GET /playground/:id/events?agentRunId=... — get events for a session
  fastify.get<{
    Params: { id: string };
    Querystring: { agentRunId?: string };
    Reply: PlaygroundEventResponse[];
  }>(
    "/playground/:id/events",
    {
      schema: {
        querystring: {
          type: "object",
          properties: {
            agentRunId: { type: "string" },
          },
        },
      },
    },
    async (request) => {
      const { agentRunId } = request.query;

      let runIds: string[];
      if (agentRunId) {
        runIds = [agentRunId];
      } else {
        const runs = await fastify.db
          .select({ id: playgroundAgentRuns.id })
          .from(playgroundAgentRuns)
          .where(eq(playgroundAgentRuns.sessionId, request.params.id));
        runIds = runs.map((r) => r.id);
      }

      if (runIds.length === 0) return [];

      const rows = await fastify.db
        .select()
        .from(playgroundEvents)
        .where(inArray(playgroundEvents.agentRunId, runIds))
        .orderBy(asc(playgroundEvents.seq))
        .limit(10_000);

      return rows.map((row) => ({
        id: row.id,
        agentRunId: row.agentRunId,
        seq: row.seq,
        timestamp: row.ts.toISOString(),
        kind: row.kind,
        payload: row.payload,
      }));
    },
  );

  // POST /playground/:id/events — append an event (called by workers)
  fastify.post<{ Params: { id: string }; Body: AppendEventRequest }>(
    "/playground/:id/events",
    {
      schema: {
        body: {
          type: "object",
          required: ["agentRunId", "seq", "kind"],
          properties: {
            agentRunId: { type: "string" },
            seq: { type: "integer", minimum: 1 },
            kind: { type: "string" },
            payload: { type: "object", additionalProperties: true },
          },
        },
      },
    },
    async (request, reply) => {
      const { agentRunId, seq, kind, payload } = request.body;

      const [row] = await fastify.db
        .insert(playgroundEvents)
        .values({
          agentRunId,
          seq,
          kind,
          payload: payload ?? {},
        })
        .returning();

      if (!row) {
        throw new Error("Failed to insert event");
      }

      options.eventBus.publish({
        id: row.id,
        runId: request.params.id,
        type: "log",
        payload: {
          source: "playground",
          eventId: row.id,
          agentRunId,
          seq,
          kind,
          timestamp: row.ts.toISOString(),
          payload: payload ?? {},
        },
        receivedAt: row.ts.toISOString(),
      });

      reply.code(201);
      return { id: row.id, seq: row.seq };
    },
  );

  // POST /playground/:id/runs/:runId — update an agent run (status, sandboxId, output, etc.)
  fastify.post<{
    Params: { id: string; runId: string };
    Body: UpdateRunRequest;
  }>(
    "/playground/:id/runs/:runId",
    {
      schema: {
        body: {
          type: "object",
          properties: {
            status: { type: "string" },
            sandboxId: { type: "string" },
            appUrl: { type: "string" },
            output: { type: "string" },
            startedAt: { type: "string" },
            finishedAt: { type: "string" },
            fileCount: { type: "integer", minimum: 0 },
            loc: { type: "integer", minimum: 0 },
          },
        },
      },
    },
    async (request, reply) => {
      const { runId, id: sessionId } = request.params;
      const body = request.body;

      const update: Partial<typeof playgroundAgentRuns.$inferInsert> = {};
      if (body.status !== undefined) update.status = body.status;
      if (body.sandboxId !== undefined) update.sandboxId = body.sandboxId;
      if (body.appUrl !== undefined) update.appUrl = body.appUrl;
      if (body.output !== undefined) update.output = body.output;
      if (body.startedAt !== undefined) update.startedAt = new Date(body.startedAt);
      if (body.finishedAt !== undefined) update.finishedAt = new Date(body.finishedAt);
      if (body.fileCount !== undefined) update.fileCount = body.fileCount;
      if (body.loc !== undefined) update.loc = body.loc;

      if (Object.keys(update).length > 0) {
        await fastify.db
          .update(playgroundAgentRuns)
          .set(update)
          .where(
            and(
              eq(playgroundAgentRuns.id, runId),
              eq(playgroundAgentRuns.sessionId, sessionId),
            ),
          );
      }

      // If the run reached a terminal state, see if the session should be finalized.
      if (body.status === "succeeded" || body.status === "failed") {
        await maybeFinalizeSession(fastify, sessionId);
      }

      reply.code(200);
      return { ok: true };
    },
  );

  // POST /playground/:id/release-sandbox — tell the worker it can kill the sandbox
  fastify.post<{ Params: { id: string } }>(
    "/playground/:id/release-sandbox",
    async (request, reply) => {
      await publishPlaygroundRelease(connection, request.params.id);
      reply.code(200);
      return { released: true };
    },
  );

  // POST /playground/:id/runs/:runId/stop — best-effort cancel an in-flight agent
  fastify.post<{ Params: { id: string; runId: string } }>(
    "/playground/:id/runs/:runId/stop",
    async (request, reply) => {
      const { id: sessionId, runId } = request.params;

      // Set the cancellation reason eagerly so the eventual /runs/:runId update
      // from the worker (which writes status=failed + output=...) doesn't blow
      // it away. The worker writes a separate column, so this stays put.
      await fastify.db
        .update(playgroundAgentRuns)
        .set({ cancellationReason: "cancelled_by_user" })
        .where(
          and(
            eq(playgroundAgentRuns.id, runId),
            eq(playgroundAgentRuns.sessionId, sessionId),
          ),
        );

      await publishPlaygroundCancelRun(connection, sessionId, runId);
      reply.code(202);
      return { cancelling: true };
    },
  );

  // POST /playground/:id/runs/:runId/follow-up — append a user turn to a running agent
  fastify.post<{
    Params: { id: string; runId: string };
    Body: { text: string };
  }>(
    "/playground/:id/runs/:runId/follow-up",
    {
      schema: {
        body: {
          type: "object",
          required: ["text"],
          additionalProperties: false,
          properties: {
            text: { type: "string", minLength: 1, maxLength: 4000 },
          },
        },
      },
    },
    async (request, reply) => {
      const { id: sessionId, runId } = request.params;
      const text = request.body.text;

      const [run] = await fastify.db
        .select({
          id: playgroundAgentRuns.id,
          sandboxId: playgroundAgentRuns.sandboxId,
        })
        .from(playgroundAgentRuns)
        .where(
          and(
            eq(playgroundAgentRuns.id, runId),
            eq(playgroundAgentRuns.sessionId, sessionId),
          ),
        )
        .limit(1);

      if (!run) {
        reply.code(404);
        throw new Error(`Agent run not found: ${runId}`);
      }
      if (!run.sandboxId) {
        reply.code(409);
        throw new Error("sandbox_released");
      }

      // Persist the user turn immediately so the transcript reflects it before
      // the worker has even processed the pub/sub message.
      const [maxRow] = await fastify.db
        .select({ value: sql<number>`COALESCE(MAX(${playgroundEvents.seq}), 0)` })
        .from(playgroundEvents)
        .where(eq(playgroundEvents.agentRunId, runId));
      const nextSeq = (Number(maxRow?.value) || 0) + 1;

      const [inserted] = await fastify.db
        .insert(playgroundEvents)
        .values({
          agentRunId: runId,
          seq: nextSeq,
          kind: "user_follow_up",
          payload: { text },
        })
        .returning();

      if (!inserted) {
        throw new Error("Failed to persist follow-up event");
      }

      // Broadcast to WebSocket subscribers so live viewers see the bubble.
      // Mirror the wrapper shape used by POST /playground/:id/events so the
      // browser-side parser in `openPlaygroundEventStream` picks it up.
      options.eventBus.publish({
        id: inserted.id,
        runId: sessionId,
        type: "log",
        payload: {
          source: "playground",
          eventId: inserted.id,
          agentRunId: inserted.agentRunId,
          seq: inserted.seq,
          kind: inserted.kind,
          timestamp: inserted.ts.toISOString(),
          payload: inserted.payload,
        },
        receivedAt: inserted.ts.toISOString(),
      });

      // Flip the agent back into a running state so the UI shows the spinner /
      // pulse while the next turn streams in.
      await fastify.db
        .update(playgroundAgentRuns)
        .set({ status: "running" })
        .where(eq(playgroundAgentRuns.id, runId));

      await publishPlaygroundFollowUp(connection, sessionId, runId, text);

      reply.code(202);
      return { accepted: true, eventId: inserted.id };
    },
  );

  // WebSocket: GET /playground/:id/stream
  fastify.get<{ Params: { id: string } }>(
    "/playground/:id/stream",
    { websocket: true },
    async (socket, request) => {
      const sessionId = request.params.id;

      socket.send(
        JSON.stringify({
          type: "connected",
          sessionId,
          time: new Date().toISOString(),
        }),
      );

      const unsubscribe = options.eventBus.subscribe(sessionId, (event) => {
        socket.send(JSON.stringify({ type: "playground.event", event }));
      });

      socket.on("close", unsubscribe);
      socket.on("error", () => {
        unsubscribe();
      });
    },
  );

  // POST /playground/:id/score — submit scores
  fastify.post<{
    Params: { id: string };
    Body: {
      scores: Array<{
        agentRunId: string;
        score: number;
        rationale?: string;
        correctness?: number | null;
        codeQuality?: number | null;
        ux?: number | null;
        shipIt?: number | null;
      }>;
    };
  }>(
    "/playground/:id/score",
    {
      schema: {
        body: {
          type: "object",
          required: ["scores"],
          properties: {
            scores: {
              type: "array",
              items: {
                type: "object",
                required: ["agentRunId", "score"],
                properties: {
                  agentRunId: { type: "string" },
                  score: { type: "integer", minimum: 0, maximum: 100 },
                  rationale: { type: "string" },
                  correctness: { type: ["integer", "null"], minimum: 0, maximum: 5 },
                  codeQuality: { type: ["integer", "null"], minimum: 0, maximum: 5 },
                  ux: { type: ["integer", "null"], minimum: 0, maximum: 5 },
                  shipIt: { type: ["integer", "null"], minimum: 0, maximum: 5 },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { scores } = request.body;

      for (const s of scores) {
        await fastify.db
          .update(playgroundAgentRuns)
          .set({
            score: s.score,
            scoreRationale: s.rationale ?? null,
            scoreCorrectness: s.correctness ?? null,
            scoreCodeQuality: s.codeQuality ?? null,
            scoreUx: s.ux ?? null,
            scoreShipIt: s.shipIt ?? null,
            scoredAt: new Date(),
          })
          .where(eq(playgroundAgentRuns.id, s.agentRunId));
      }

      const runs = await fastify.db
        .select()
        .from(playgroundAgentRuns)
        .where(eq(playgroundAgentRuns.sessionId, request.params.id));

      const allScored = runs.every((r) => r.score !== null);
      if (allScored) {
        await fastify.db
          .update(playgroundSessions)
          .set({ status: "completed", completedAt: new Date() })
          .where(eq(playgroundSessions.id, request.params.id));
      }

      // Submitting scores implies the human is done reviewing the sandbox.
      await publishPlaygroundRelease(connection, request.params.id);

      reply.code(200);
      return { accepted: true };
    },
  );

  // POST /playground/:id/grade-auto — trigger auto-grading with one or more graders
  fastify.post<{
    Params: { id: string };
    Body: { graders?: string[] } | null;
  }>(
    "/playground/:id/grade-auto",
    {
      schema: {
        body: {
          oneOf: [
            {
              type: "object",
              additionalProperties: false,
              properties: {
                graders: {
                  type: "array",
                  minItems: 1,
                  maxItems: 3,
                  items: { type: "string" },
                },
              },
            },
            { type: "null" },
          ],
        },
      },
    },
    async (request, reply) => {
      const [session] = await fastify.db
        .select()
        .from(playgroundSessions)
        .where(eq(playgroundSessions.id, request.params.id))
        .limit(1);

      if (!session) {
        reply.code(404);
        throw new Error(`Playground session not found: ${request.params.id}`);
      }

      const requested = request.body?.graders;
      const graderIds: string[] =
        requested && requested.length > 0
          ? Array.from(new Set(requested))
          : [session.graderModelId ?? "openai/gpt-4o"];

      const runs = await fastify.db
        .select()
        .from(playgroundAgentRuns)
        .where(eq(playgroundAgentRuns.sessionId, request.params.id));

      const apiKey = process.env.OPENROUTER_API_KEY;
      if (!apiKey) {
        reply.code(500);
        throw new Error("OPENROUTER_API_KEY not configured");
      }

      const enqueuedRunIds: string[] = [];

      // Each grader becomes a playground_autograder_runs row; we do the work
      // synchronously inside the request since calls are short and there's
      // no concurrency issue (a session has at most ~5 agents × ~3 graders).
      for (const graderId of graderIds) {
        const [autoRow] = await fastify.db
          .insert(playgroundAutograderRuns)
          .values({
            sessionId: session.id,
            graderModelId: graderId,
            status: "running",
          })
          .returning();

        if (!autoRow) continue;
        enqueuedRunIds.push(autoRow.id);

        const startedAt = Date.now();
        try {
          for (const run of runs) {
            if (!run.output) continue;

            const result = await gradePlaygroundOutput({
              prompt: session.prompt,
              modelName: run.modelName,
              output: run.output,
              apiKey,
              modelId: graderId,
            });

            await fastify.db
              .insert(playgroundAutograderScores)
              .values({
                autograderRunId: autoRow.id,
                agentRunId: run.id,
                overall: result.score,
                correctness: result.correctness ?? null,
                codeQuality: result.codeQuality ?? null,
                ux: result.ux ?? null,
                shipIt: result.shipIt ?? null,
                rationale: result.reasoning,
              });

            // Mirror onto the agent run when this is the first / only grader
            // so the existing "score" column stays meaningful for non-multi-grader users.
            if (graderIds.length === 1 && run.score === null) {
              await fastify.db
                .update(playgroundAgentRuns)
                .set({
                  score: result.score,
                  scoreRationale: result.reasoning,
                  scoreCorrectness: result.correctness ?? null,
                  scoreCodeQuality: result.codeQuality ?? null,
                  scoreUx: result.ux ?? null,
                  scoreShipIt: result.shipIt ?? null,
                  scoredAt: new Date(),
                })
                .where(eq(playgroundAgentRuns.id, run.id));
            }
          }

          await fastify.db
            .update(playgroundAutograderRuns)
            .set({
              status: "completed",
              latencyMs: Date.now() - startedAt,
              finishedAt: new Date(),
            })
            .where(eq(playgroundAutograderRuns.id, autoRow.id));
        } catch (err) {
          request.log.error({ err, graderId }, "Auto-grading failed");
          await fastify.db
            .update(playgroundAutograderRuns)
            .set({
              status: "failed",
              errorMessage: err instanceof Error ? err.message : String(err),
              finishedAt: new Date(),
              latencyMs: Date.now() - startedAt,
            })
            .where(eq(playgroundAutograderRuns.id, autoRow.id));
        }
      }

      if (graderIds.length === 1) {
        await fastify.db
          .update(playgroundSessions)
          .set({ status: "completed", completedAt: new Date() })
          .where(eq(playgroundSessions.id, request.params.id));
      }

      // Auto-grading implies the human is done with the live sandbox.
      await publishPlaygroundRelease(connection, request.params.id);

      reply.code(200);
      return { accepted: true, autograderRunIds: enqueuedRunIds };
    },
  );

  // GET /playground/:id/autograders — list autograder runs + scores for a session
  fastify.get<{ Params: { id: string } }>(
    "/playground/:id/autograders",
    async (request) => {
      const sessionId = request.params.id;
      const autograderRows = await fastify.db
        .select()
        .from(playgroundAutograderRuns)
        .where(eq(playgroundAutograderRuns.sessionId, sessionId))
        .orderBy(desc(playgroundAutograderRuns.createdAt));

      if (autograderRows.length === 0) return [];

      const runIds = autograderRows.map((r) => r.id);
      const scoreRows = await fastify.db
        .select()
        .from(playgroundAutograderScores)
        .where(inArray(playgroundAutograderScores.autograderRunId, runIds));

      const byRun = new Map<string, typeof scoreRows>();
      for (const s of scoreRows) {
        const bucket = byRun.get(s.autograderRunId) ?? [];
        bucket.push(s);
        byRun.set(s.autograderRunId, bucket);
      }

      return autograderRows.map((r) => ({
        id: r.id,
        graderModelId: r.graderModelId,
        status: r.status,
        latencyMs: r.latencyMs,
        usdCost: r.usdCost,
        errorMessage: r.errorMessage,
        createdAt: r.createdAt.toISOString(),
        finishedAt: r.finishedAt?.toISOString() ?? null,
        scores: (byRun.get(r.id) ?? []).map((s) => ({
          agentRunId: s.agentRunId,
          overall: s.overall,
          correctness: s.correctness,
          codeQuality: s.codeQuality,
          ux: s.ux,
          shipIt: s.shipIt,
          rationale: s.rationale,
        })),
      }));
    },
  );

  // POST /playground/:id/save and /unsave — toggle pinned flag
  fastify.post<{ Params: { id: string } }>(
    "/playground/:id/save",
    async (request, reply) => {
      await fastify.db
        .update(playgroundSessions)
        .set({ saved: true })
        .where(eq(playgroundSessions.id, request.params.id));
      reply.code(200);
      return { saved: true };
    },
  );

  fastify.post<{ Params: { id: string } }>(
    "/playground/:id/unsave",
    async (request, reply) => {
      await fastify.db
        .update(playgroundSessions)
        .set({ saved: false })
        .where(eq(playgroundSessions.id, request.params.id));
      reply.code(200);
      return { saved: false };
    },
  );

  // PATCH /playground/:id — update title, tags, saved, share token
  fastify.patch<{
    Params: { id: string };
    Body: {
      title?: string | null;
      tags?: string[];
      saved?: boolean;
      shareEnabled?: boolean;
    };
  }>(
    "/playground/:id",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: ["string", "null"], maxLength: 200 },
            tags: { type: "array", items: { type: "string", maxLength: 64 }, maxItems: 16 },
            saved: { type: "boolean" },
            shareEnabled: { type: "boolean" },
          },
        },
      },
    },
    async (request, reply) => {
      const body = request.body;
      const update: Partial<typeof playgroundSessions.$inferInsert> = {};
      if (body.title !== undefined) update.title = body.title;
      if (body.tags !== undefined) {
        update.tags = Array.from(new Set(body.tags.map((t) => t.trim().toLowerCase()).filter(Boolean)));
      }
      if (body.saved !== undefined) update.saved = body.saved;
      if (body.shareEnabled !== undefined) {
        update.shareToken = body.shareEnabled ? randomUUID().replace(/-/g, "") : null;
      }

      if (Object.keys(update).length > 0) {
        await fastify.db
          .update(playgroundSessions)
          .set(update)
          .where(eq(playgroundSessions.id, request.params.id));
      }

      const response = await buildSessionResponse(fastify, request.params.id);
      if (!response) {
        reply.code(404);
        throw new Error("Session not found");
      }
      return response;
    },
  );

  // GET /playground/leaderboard?window=7d|30d|90d — model aggregates
  fastify.get<{
    Querystring: { window?: string; metric?: string };
  }>(
    "/playground/leaderboard",
    async (request) => {
      const window = request.query.window === "7d" || request.query.window === "30d" ? request.query.window : "90d";
      const days = window === "7d" ? 7 : window === "30d" ? 30 : 90;

      // We avoid drizzle's query builder here: the aggregate uses a CTE that's
      // simpler to express as raw SQL than to fight the type plumbing for.
      const rows = await fastify.db.execute(sql`
        WITH per_session AS (
          SELECT
            par.model_id,
            par.model_name,
            par.session_id,
            AVG(par.score)::numeric(6, 2) AS session_score,
            MAX(CASE WHEN par.score = sub.max_score THEN 1 ELSE 0 END) AS win_in_session
          FROM playground_agent_runs par
          JOIN (
            SELECT session_id, MAX(score) AS max_score
            FROM playground_agent_runs
            WHERE score IS NOT NULL
            GROUP BY session_id
          ) sub USING (session_id)
          WHERE par.score IS NOT NULL
            AND par.created_at >= now() - (${days}::int * interval '1 day')
          GROUP BY par.model_id, par.model_name, par.session_id, sub.max_score
        )
        SELECT
          model_id,
          MAX(model_name) AS model_name,
          COUNT(*)::int AS sessions_played,
          ROUND(AVG(session_score), 1)::float8 AS avg_score,
          ROUND(100.0 * SUM(win_in_session) / NULLIF(COUNT(*), 0), 1)::float8 AS win_rate
        FROM per_session
        GROUP BY model_id
        ORDER BY win_rate DESC NULLS LAST, avg_score DESC NULLS LAST
      `);

      return {
        window,
        rows: (rows as unknown as Array<{
          model_id: string;
          model_name: string;
          sessions_played: number;
          avg_score: number | null;
          win_rate: number | null;
        }>).map((r) => ({
          modelId: r.model_id,
          modelName: r.model_name,
          sessionsPlayed: r.sessions_played,
          avgScore: r.avg_score,
          winRate: r.win_rate,
        })),
      };
    },
  );

  // GET /playground/share/:token — public read-only session view
  fastify.get<{ Params: { token: string } }>(
    "/playground/share/:token",
    async (request, reply) => {
      const [row] = await fastify.db
        .select({ id: playgroundSessions.id })
        .from(playgroundSessions)
        .where(eq(playgroundSessions.shareToken, request.params.token))
        .limit(1);

      if (!row) {
        reply.code(404);
        throw new Error("Share link not found");
      }

      const response = await buildSessionResponse(fastify, row.id);
      if (!response) {
        reply.code(404);
        throw new Error("Share link not found");
      }
      return response;
    },
  );
};

async function buildSessionResponse(
  fastify: { db: import("@pilab/db").DbClient },
  sessionId: string,
): Promise<PlaygroundSessionResponse | null> {
  const [session] = await fastify.db
    .select()
    .from(playgroundSessions)
    .where(eq(playgroundSessions.id, sessionId))
    .limit(1);

  if (!session) return null;

  const runs = await fastify.db
    .select()
    .from(playgroundAgentRuns)
    .where(eq(playgroundAgentRuns.sessionId, sessionId))
    .orderBy(asc(playgroundAgentRuns.createdAt));

  return {
    id: session.id,
    prompt: session.prompt,
    status: session.status,
    gradingMode: session.gradingMode,
    graderModelId: session.graderModelId,
    createdAt: session.createdAt.toISOString(),
    completedAt: session.completedAt?.toISOString() ?? null,
    saved: session.saved,
    title: session.title,
    tags: session.tags ?? [],
    shareToken: session.shareToken,
    agentRuns: runs.map((r) => ({
      id: r.id,
      modelId: r.modelId,
      modelName: r.modelName,
      status: r.status,
      sandboxId: r.sandboxId,
      appUrl: r.appUrl,
      output: r.output,
      score: r.score,
      scoreRationale: r.scoreRationale,
      scoreCorrectness: r.scoreCorrectness,
      scoreCodeQuality: r.scoreCodeQuality,
      scoreUx: r.scoreUx,
      scoreShipIt: r.scoreShipIt,
      fileCount: r.fileCount,
      loc: r.loc,
      createdAt: r.createdAt.toISOString(),
      startedAt: r.startedAt?.toISOString() ?? null,
      finishedAt: r.finishedAt?.toISOString() ?? null,
    })),
  };
}

// If every agent_run for this session is in a terminal state and all failed,
// mark the session as failed. (Mixed succeeded/failed runs keep the session
// in 'running' so the user can still score it via /score or /grade-auto.)
async function maybeFinalizeSession(
  fastify: { db: import("@pilab/db").DbClient },
  sessionId: string,
): Promise<void> {
  const runs = await fastify.db
    .select({ status: playgroundAgentRuns.status })
    .from(playgroundAgentRuns)
    .where(eq(playgroundAgentRuns.sessionId, sessionId));

  if (runs.length === 0) return;

  const allTerminal = runs.every((r) => r.status === "succeeded" || r.status === "failed");
  if (!allTerminal) return;

  const allFailed = runs.every((r) => r.status === "failed");
  if (allFailed) {
    await fastify.db
      .update(playgroundSessions)
      .set({ status: "failed", completedAt: new Date() })
      .where(eq(playgroundSessions.id, sessionId));
  }
}

async function gradePlaygroundOutput(input: {
  prompt: string;
  modelName: string;
  output: string;
  apiKey: string;
  modelId: string;
}): Promise<{
  score: number;
  reasoning: string;
  correctness?: number;
  codeQuality?: number;
  ux?: number;
  shipIt?: number;
}> {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: input.modelId,
      messages: [
        {
          role: "system",
          content: `You are evaluating how well an AI coding agent completed a task.
For the given task and agent output, rate four 1-5 axes:

- correctness: does it satisfy the task requirements?
- code_quality: is the code well-structured and idiomatic?
- ux: is the resulting UX / interface polished where applicable?
- ship_it: would you ship this as-is?

Then compute an overall score (0-100) as a weighted blend (correctness 40 %, code_quality 25 %, ux 15 %, ship_it 20 %, mapped from 1-5 to 0-20 each).

Be fair and consistent. Return JSON exactly: { "score": number, "correctness": int, "code_quality": int, "ux": int, "ship_it": int, "reasoning": string }`,
        },
        {
          role: "user",
          content: `Task: ${input.prompt}\n\nAgent (${input.modelName}) Output:\n${input.output}`,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "playground_grade",
          strict: true,
          schema: {
            type: "object",
            properties: {
              score: { type: "number" },
              correctness: { type: "integer", minimum: 1, maximum: 5 },
              code_quality: { type: "integer", minimum: 1, maximum: 5 },
              ux: { type: "integer", minimum: 1, maximum: 5 },
              ship_it: { type: "integer", minimum: 1, maximum: 5 },
              reasoning: { type: "string" },
            },
            required: ["score", "correctness", "code_quality", "ux", "ship_it", "reasoning"],
            additionalProperties: false,
          },
        },
      },
      temperature: 0,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Grader API error: ${text.slice(0, 500)}`);
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
  };

  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("No content in grader response");

  const parsed = JSON.parse(content) as {
    score: number;
    correctness?: number;
    code_quality?: number;
    ux?: number;
    ship_it?: number;
    reasoning: string;
  };
  const result: ReturnType<typeof gradePlaygroundOutput> extends Promise<infer T> ? T : never = {
    score: parsed.score,
    reasoning: parsed.reasoning,
  };
  if (typeof parsed.correctness === "number") result.correctness = parsed.correctness;
  if (typeof parsed.code_quality === "number") result.codeQuality = parsed.code_quality;
  if (typeof parsed.ux === "number") result.ux = parsed.ux;
  if (typeof parsed.ship_it === "number") result.shipIt = parsed.ship_it;
  return result;
}
