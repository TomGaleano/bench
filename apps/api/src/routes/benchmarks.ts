import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  agentConfigs,
  artifacts,
  benchmarkCases,
  caseVersions,
  datasetCases,
  datasets,
  evaluations,
  experimentAgentConfigs,
  experimentCaseVersions,
  experiments,
  githubIssues,
  harnessVersions,
  plans,
  planScores,
  runGroups,
  runs,
} from "@pilab/db/schema";
import type { DbClient } from "@pilab/db";
import { createApiObjectStore } from "../object-store.js";
import {
  createPiRunnerQueue,
  createRedisConnection,
  enqueueBenchmarkBatchJob,
  type BenchmarkBatchAgentSpec,
  createGradingExternalQueue,
  enqueueGradingExternalJob,
} from "@pilab/jobs";
import type { FastifyPluginAsync } from "fastify";

type JsonRecord = Record<string, unknown>;

const emptyObject = sql`'{}'::jsonb`;

export const benchmarkRoutes: FastifyPluginAsync = async (fastify) => {
  const redisUrl = process.env.REDIS_URL ?? "redis://localhost:56380";
  const connection = createRedisConnection(redisUrl, {
    maxRetriesPerRequest: null,
  });
  const piRunnerQueue = createPiRunnerQueue({ connection });
  const gradingExternalQueue = createGradingExternalQueue(connection);

  fastify.addHook("onClose", async () => {
    await piRunnerQueue.close();
    await gradingExternalQueue.close();
    await connection.quit();
  });

  // ──────────────────────────────
  // POST /benchmarks
  // ──────────────────────────────
  fastify.post(
    "/benchmarks",
    {
      schema: {
        body: {
          type: "object",
          required: ["name", "datasetId", "mode", "agentConfigs"],
          additionalProperties: false,
          properties: {
            name: { type: "string", minLength: 1 },
            description: { type: "string" },
            datasetId: { type: "string", format: "uuid" },
            mode: {
              type: "string",
              enum: ["plan_only", "implementation_only", "end_to_end"],
            },
            agentConfigs: {
              type: "array",
              minItems: 1,
              items: {
                type: "object",
                required: ["modelId"],
                additionalProperties: false,
                properties: {
                  modelId: { type: "string", minLength: 1 },
                  mode: {
                    type: "string",
                    enum: ["plan_only", "implementation_only", "end_to_end"],
                  },
                  maxTurns: { type: "integer", minimum: 1, maximum: 50 },
                  maxWallClockSeconds: {
                    type: "integer",
                    minimum: 5,
                    maximum: 3600,
                  },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const body = request.body as {
        name: string;
        description?: string;
        datasetId: string;
        mode: "plan_only" | "implementation_only" | "end_to_end";
        agentConfigs: Array<{
          modelId: string;
          mode?: "plan_only" | "implementation_only" | "end_to_end";
          maxTurns?: number;
          maxWallClockSeconds?: number;
        }>;
      };

      const db = fastify.db;

      // Verify dataset exists
      const [dataset] = await db
        .select()
        .from(datasets)
        .where(eq(datasets.id, body.datasetId))
        .limit(1);

      if (!dataset) {
        reply.code(404);
        return { error: "Dataset not found" };
      }

      // Find the Pi harness version
      const [harnessVersion] = await db
        .select()
        .from(harnessVersions)
        .where(eq(harnessVersions.harness, "pi"))
        .limit(1);

      const harnessVersionId = harnessVersion?.id;

      // Insert experiment
      const [experiment] = await db
        .insert(experiments)
        .values({
          name: body.name,
          description: body.description ?? null,
          datasetId: body.datasetId,
          mode: body.mode,
          status: "queued",
          matrix: {
            agentCount: body.agentConfigs.length,
            datasetId: body.datasetId,
          },
        })
        .returning();

      if (!experiment) {
        reply.code(500);
        return { error: "Failed to create experiment" };
      }

      // Create agent_configs and experiment_agent_configs
      const agentConfigIds: string[] = [];
      for (const agentCfg of body.agentConfigs) {
        const agentMode = agentCfg.mode ?? body.mode;

        const [created] = await db
          .insert(agentConfigs)
          .values({
            name: `${agentCfg.modelId} - ${agentMode}`,
            mode: agentMode,
            harnessVersionId: harnessVersionId ?? null,
            toolPolicy: {},
            modelSettings: { modelId: agentCfg.modelId },
          })
          .returning();

        if (!created) {
          reply.code(500);
          return { error: "Failed to create agent config" };
        }

        agentConfigIds.push(created.id);

        await db.insert(experimentAgentConfigs).values({
          experimentId: experiment.id,
          agentConfigId: created.id,
        });
      }

      // Find all cases in the dataset and their latest case versions
      const datasetCaseRows = await db
        .select({
          caseId: datasetCases.caseId,
        })
        .from(datasetCases)
        .where(eq(datasetCases.datasetId, body.datasetId))
        .orderBy(datasetCases.orderIndex);

      const caseVersionIds: string[] = [];
      for (const dc of datasetCaseRows) {
        const [latestVersion] = await db
          .select()
          .from(caseVersions)
          .where(eq(caseVersions.caseId, dc.caseId))
          .orderBy(desc(caseVersions.version))
          .limit(1);

        if (latestVersion) {
          caseVersionIds.push(latestVersion.id);

          await db.insert(experimentCaseVersions).values({
            experimentId: experiment.id,
            caseVersionId: latestVersion.id,
          });
        }
      }

      reply.code(201);
      return {
        experiment: {
          id: experiment.id,
          name: experiment.name,
          description: experiment.description,
          datasetId: experiment.datasetId,
          mode: experiment.mode,
          status: experiment.status,
          createdAt: experiment.createdAt.toISOString(),
          updatedAt: experiment.updatedAt.toISOString(),
        },
        agentConfigIds,
        caseVersionIds,
        caseCount: caseVersionIds.length,
      };
    },
  );

  // ──────────────────────────────
  // GET /benchmarks
  // ──────────────────────────────
  fastify.get("/benchmarks", async (_request) => {
    const db = fastify.db;

    const rows = await db
      .select({
        id: experiments.id,
        name: experiments.name,
        status: experiments.status,
        mode: experiments.mode,
        datasetId: experiments.datasetId,
        createdAt: experiments.createdAt,
        runCount: sql<number>`count(${runs.id})`.as("run_count"),
        completedRunCount:
          sql<number>`count(${runs.id}) FILTER (WHERE ${runs.status} = 'succeeded')`.as(
            "completed_run_count",
          ),
      })
      .from(experiments)
      .leftJoin(runs, eq(runs.experimentId, experiments.id))
      .where(sql`${experiments.datasetId} IS NOT NULL`)
      .groupBy(experiments.id)
      .orderBy(desc(experiments.createdAt));

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      datasetSlug: "",
      datasetName: null,
      status: r.status,
      agent1ModelId: "",
      agent1Mode: r.mode,
      agent2ModelId: null,
      agent2Mode: null,
      totalCases: 0,
      totalRuns: Number(r.runCount),
      completedRuns: Number(r.completedRunCount),
      failedRuns: 0,
      createdAt: r.createdAt.toISOString(),
      startedAt: null,
      finishedAt: null,
    }));
  });

  // ──────────────────────────────
  // GET /benchmarks/:id
  // ──────────────────────────────
  fastify.get(
    "/benchmarks/:id",
    {
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: {
            id: { type: "string", format: "uuid" },
          },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const db = fastify.db;

      const [experiment] = await db
        .select()
        .from(experiments)
        .where(eq(experiments.id, id))
        .limit(1);

      if (!experiment) {
        reply.code(404);
        return { error: "Benchmark experiment not found" };
      }

      // Fetch agent configs
      const agentConfigRows = await db
        .select({
          agentConfigId: agentConfigs.id,
          name: agentConfigs.name,
          mode: agentConfigs.mode,
          modelId: sql<string>`${agentConfigs.modelSettings}->>'modelId'`,
          maxTurns:
            sql<number | null>`(${agentConfigs.modelSettings}->>'maxTurns')::integer`,
          maxWallClockSeconds:
            sql<number | null>`(${agentConfigs.modelSettings}->>'maxWallClockSeconds')::integer`,
        })
        .from(experimentAgentConfigs)
        .innerJoin(
          agentConfigs,
          eq(experimentAgentConfigs.agentConfigId, agentConfigs.id),
        )
        .where(eq(experimentAgentConfigs.experimentId, experiment.id));

      // Fetch case versions with case info
      const caseVersionRows = await db
        .select({
          caseVersionId: caseVersions.id,
          version: caseVersions.version,
          caseId: benchmarkCases.id,
          caseSlug: benchmarkCases.slug,
          caseTitle: benchmarkCases.title,
          repoOwner: caseVersions.repoOwner,
          repoName: caseVersions.repoName,
        })
        .from(experimentCaseVersions)
        .innerJoin(
          caseVersions,
          eq(experimentCaseVersions.caseVersionId, caseVersions.id),
        )
        .innerJoin(
          benchmarkCases,
          eq(caseVersions.caseId, benchmarkCases.id),
        )
        .where(eq(experimentCaseVersions.experimentId, experiment.id));

      // Fetch runs for this experiment
      const runRows = await db
        .select({
          id: runs.id,
          runGroupId: runs.runGroupId,
          caseVersionId: runs.caseVersionId,
          agentConfigId: runs.agentConfigId,
          mode: runs.mode,
          status: runs.status,
          openRouterModelId: runs.openRouterModelId,
          createdAt: runs.createdAt,
          startedAt: runs.startedAt,
          finishedAt: runs.finishedAt,
          chargedCost: runs.chargedCost,
          computedCost: runs.computedCost,
          error: runs.error,
        })
        .from(runs)
        .where(eq(runs.experimentId, experiment.id))
        .orderBy(asc(runs.createdAt));

      // Fetch plans and plan_scores for all experiment runs
      const runIds = runRows.map((r) => r.id);

      const planRows =
        runIds.length > 0
          ? await db
              .select()
              .from(plans)
              .where(inArray(plans.runId, runIds))
          : [];

      const planScoreRows =
        planRows.length > 0
          ? await db
              .select()
              .from(planScores)
              .where(
                inArray(
                  planScores.planId,
                  planRows.map((p) => p.id),
                ),
              )
          : [];

      const evaluationRows =
        runIds.length > 0
          ? await db
              .select()
              .from(evaluations)
              .where(inArray(evaluations.runId, runIds))
          : [];

      // Fetch run groups
      const runGroupRows = await db
        .select()
        .from(runGroups)
        .where(eq(runGroups.experimentId, experiment.id));

      // Look up the dataset for the flat fields the web detail page consumes.
      const [datasetRow] = experiment.datasetId
        ? await db
            .select({ slug: datasets.slug, name: datasets.name })
            .from(datasets)
            .where(eq(datasets.id, experiment.datasetId))
            .limit(1)
        : [];

      // Web page (apps/web/app/benchmarks/[id]/page.tsx) expects flat
      // BenchmarkExperiment fields alongside the nested detail data.
      const flatCompletedRuns = runRows.filter((r) => r.status === "succeeded").length;
      const flatFailedRuns = runRows.filter((r) => r.status === "failed" || r.status === "timed_out").length;
      const agentModelIds = agentConfigRows.map((a) => a.modelId);

      reply.code(200);
      return {
        // ── Flat shape used by the live web detail page ──
        id: experiment.id,
        name: experiment.name,
        datasetSlug: datasetRow?.slug ?? "",
        datasetName: datasetRow?.name ?? null,
        status: experiment.status,
        agent1ModelId: agentModelIds[0] ?? "",
        agent1Mode: agentConfigRows[0]?.mode ?? experiment.mode,
        agent2ModelId: agentModelIds[1] ?? null,
        agent2Mode: agentConfigRows[1]?.mode ?? null,
        totalCases: caseVersionRows.length,
        totalRuns: runRows.length,
        completedRuns: flatCompletedRuns,
        failedRuns: flatFailedRuns,
        createdAt: experiment.createdAt.toISOString(),
        startedAt: experiment.startedAt?.toISOString() ?? null,
        finishedAt: experiment.finishedAt?.toISOString() ?? null,
        // ── Nested detail kept for richer consumers ──
        experiment: {
          id: experiment.id,
          name: experiment.name,
          description: experiment.description,
          datasetId: experiment.datasetId,
          mode: experiment.mode,
          status: experiment.status,
          matrix: experiment.matrix,
          createdAt: experiment.createdAt.toISOString(),
          updatedAt: experiment.updatedAt.toISOString(),
          startedAt: experiment.startedAt?.toISOString() ?? null,
          finishedAt: experiment.finishedAt?.toISOString() ?? null,
        },
        agentConfigs: agentConfigRows,
        caseVersions: caseVersionRows,
        runGroups: runGroupRows.map((rg) => ({
          id: rg.id,
          caseVersionId: rg.caseVersionId,
          agentConfigId: rg.agentConfigId,
          name: rg.name,
          status: rg.status,
          createdAt: rg.createdAt.toISOString(),
          startedAt: rg.startedAt?.toISOString() ?? null,
          finishedAt: rg.finishedAt?.toISOString() ?? null,
        })),
        runs: runRows.map((r) => ({
          id: r.id,
          runGroupId: r.runGroupId,
          caseVersionId: r.caseVersionId,
          agentConfigId: r.agentConfigId,
          mode: r.mode,
          status: r.status,
          modelId: r.openRouterModelId,
          createdAt: r.createdAt.toISOString(),
          startedAt: r.startedAt?.toISOString() ?? null,
          finishedAt: r.finishedAt?.toISOString() ?? null,
          chargedCost: r.chargedCost != null ? Number(r.chargedCost) : null,
          computedCost: r.computedCost != null ? Number(r.computedCost) : null,
          error: r.error ?? null,
          plan: planRows
            .filter((p) => p.runId === r.id)
            .map((p) => ({
              id: p.id,
              planMarkdown: p.planMarkdown,
              scores: planScoreRows
                .filter((ps) => ps.planId === p.id)
                .map((ps) => ({
                  id: ps.id,
                  overallScore: Number(ps.overallScore),
                  correctnessScore: ps.correctnessScore,
                  completenessScore: ps.completenessScore,
                  safetyScore: ps.safetyScore,
                  rationale: ps.rationale,
                })),
            }))[0] ?? null,
          evaluations: evaluationRows
            .filter((ev) => ev.runId === r.id)
            .map((ev) => ({
              id: ev.id,
              status: ev.status,
              resolved: ev.resolved,
              failToPassPassed: ev.failToPassPassed,
              failToPassTotal: ev.failToPassTotal,
              passToPassPassed: ev.passToPassPassed,
              passToPassTotal: ev.passToPassTotal,
              diffSimilarityScore: ev.diffSimilarityScore
                ? Number(ev.diffSimilarityScore)
                : null,
            })),
        })),
        runCount: runRows.length,
        caseVersionCount: caseVersionRows.length,
        agentConfigCount: agentConfigRows.length,
      };
    },
  );

  // ──────────────────────────────
  // POST /benchmarks/:id/start
  // ──────────────────────────────
  fastify.post(
    "/benchmarks/:id/start",
    {
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: {
            id: { type: "string", format: "uuid" },
          },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const db = fastify.db;

      // Verify experiment exists
      const [experiment] = await db
        .select()
        .from(experiments)
        .where(eq(experiments.id, id))
        .limit(1);

      if (!experiment) {
        reply.code(404);
        return { error: "Benchmark experiment not found" };
      }

      if (experiment.status !== "queued") {
        reply.code(409);
        return {
          error: `Experiment cannot be started because it is ${experiment.status}`,
        };
      }

      // Fetch experiment_agent_configs
      const expAgentConfigs = await db
        .select()
        .from(experimentAgentConfigs)
        .where(eq(experimentAgentConfigs.experimentId, experiment.id));

      // Fetch experiment_case_versions
      const expCaseVersions = await db
        .select()
        .from(experimentCaseVersions)
        .where(eq(experimentCaseVersions.experimentId, experiment.id));

      if (expAgentConfigs.length === 0 || expCaseVersions.length === 0) {
        reply.code(400);
        return {
          error:
            "Experiment has no agent configs or case versions. Add them before starting.",
        };
      }

      let runCount = 0;

      // One benchmark-batch job per case_version. All agent configs for the
      // experiment share one E2B sandbox + worktrees inside the runner, so we
      // batch them together here instead of enqueuing one job per (case ×
      // agent) pair.
      for (const ecv of expCaseVersions) {
        const agentSpecs: BenchmarkBatchAgentSpec[] = [];
        let maxBatchWallClock = 0;

        for (const eac of expAgentConfigs) {
          const [agentConfig] = await db
            .select()
            .from(agentConfigs)
            .where(eq(agentConfigs.id, eac.agentConfigId))
            .limit(1);
          if (!agentConfig) continue;

          const settings = (agentConfig.modelSettings as JsonRecord) ?? {};
          const modelId = String(settings["modelId"] ?? "unknown");
          const modelName = String(
            settings["modelName"] ?? agentConfig.name ?? modelId,
          );
          const maxWallClockSeconds = Number(
            settings["maxWallClockSeconds"] ?? 900,
          );
          maxBatchWallClock = Math.max(maxBatchWallClock, maxWallClockSeconds);

          const [runGroup] = await db
            .insert(runGroups)
            .values({
              experimentId: experiment.id,
              caseVersionId: ecv.caseVersionId,
              agentConfigId: eac.agentConfigId,
              status: "queued",
            })
            .returning();
          if (!runGroup) continue;

          const [run] = await db
            .insert(runs)
            .values({
              experimentId: experiment.id,
              runGroupId: runGroup.id,
              caseVersionId: ecv.caseVersionId,
              agentConfigId: eac.agentConfigId,
              mode: agentConfig.mode,
              status: "queued",
              openRouterModelId: modelId,
              providerRoutingConfig: {},
              fallbackPolicy: { enabled: false },
            })
            .returning();
          if (!run) continue;

          agentSpecs.push({
            runId: run.id,
            modelId,
            modelName,
            maxWallClockSeconds,
          });
          runCount++;
        }

        if (agentSpecs.length === 0) continue;

        await enqueueBenchmarkBatchJob(piRunnerQueue, {
          experimentId: experiment.id,
          caseVersionId: ecv.caseVersionId,
          agentRuns: agentSpecs,
          ...(maxBatchWallClock > 0 ? { maxWallClockSeconds: maxBatchWallClock } : {}),
          enqueuedAt: new Date().toISOString(),
        });
      }

      // Update experiment status
      const now = new Date();
      const [updated] = await db
        .update(experiments)
        .set({
          status: "running",
          startedAt: now,
          updatedAt: now,
        })
        .where(eq(experiments.id, experiment.id))
        .returning();

      reply.code(200);
      return {
        experimentId: experiment.id,
        status: updated?.status ?? "running",
        runCount,
        enqueuedAt: now.toISOString(),
      };
    },
  );

  // ──────────────────────────────
  // GET /benchmarks/:id/results
  // ──────────────────────────────
  fastify.get(
    "/benchmarks/:id/results",
    {
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: {
            id: { type: "string", format: "uuid" },
          },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const db = fastify.db;

      const [experiment] = await db
        .select()
        .from(experiments)
        .where(eq(experiments.id, id))
        .limit(1);

      if (!experiment) {
        reply.code(404);
        return { error: "Benchmark experiment not found" };
      }

      // Fetch all runs for this experiment
      const runRows = await db
        .select({
          id: runs.id,
          runGroupId: runs.runGroupId,
          caseVersionId: runs.caseVersionId,
          agentConfigId: runs.agentConfigId,
          mode: runs.mode,
          status: runs.status,
          openRouterModelId: runs.openRouterModelId,
          createdAt: runs.createdAt,
          startedAt: runs.startedAt,
          finishedAt: runs.finishedAt,
        })
        .from(runs)
        .where(eq(runs.experimentId, experiment.id))
        .orderBy(asc(runs.createdAt));

      const runIds = runRows.map((r) => r.id);

      // Fetch plans
      const planRows =
        runIds.length > 0
          ? await db.select().from(plans).where(inArray(plans.runId, runIds))
          : [];

      // Fetch plan scores
      const planIds = planRows.map((p) => p.id);
      const planScoreRows =
        planIds.length > 0
          ? await db
              .select()
              .from(planScores)
              .where(inArray(planScores.planId, planIds))
          : [];

      // Fetch evaluations
      const evaluationRows =
        runIds.length > 0
          ? await db
              .select()
              .from(evaluations)
              .where(inArray(evaluations.runId, runIds))
          : [];

      // Fetch agent configs to get model info
      const agentConfigIds = [
        ...new Set(runRows.map((r) => r.agentConfigId).filter(Boolean)),
      ] as string[];
      const agentConfigRows =
        agentConfigIds.length > 0
          ? await db
              .select()
              .from(agentConfigs)
              .where(inArray(agentConfigs.id, agentConfigIds))
          : [];

      // Fetch case versions for context
      const caseVersionIds = [
        ...new Set(runRows.map((r) => r.caseVersionId).filter(Boolean)),
      ] as string[];
      const caseVersionRows =
        caseVersionIds.length > 0
          ? await db
              .select({
                id: caseVersions.id,
                caseId: caseVersions.caseId,
                version: caseVersions.version,
                repoOwner: caseVersions.repoOwner,
                repoName: caseVersions.repoName,
              })
              .from(caseVersions)
              .where(inArray(caseVersions.id, caseVersionIds))
          : [];

      const caseVersionMap = new Map(
        caseVersionRows.map((cv) => [cv.id, cv]),
      );
      const agentConfigMap = new Map(
        agentConfigRows.map((ac) => [ac.id, ac]),
      );

      // Group runs by case version for per-case results
      const byCaseMap = new Map<
        string,
        {
          caseVersionId: string;
          caseId: string;
          version: number;
          repo: string;
          agents: Array<{
            agentConfigId: string;
            modelId: string;
            runId: string;
            status: string;
            planScore: number | null;
            implScore: {
              resolved: boolean;
              failToPass: string;
              passToPass: string;
              diffSimilarity: number | null;
            } | null;
          }>;
        }
      >();

      for (const run of runRows) {
        const cv = caseVersionMap.get(run.caseVersionId ?? "");
        if (!cv) continue;

        if (!byCaseMap.has(cv.id)) {
          byCaseMap.set(cv.id, {
            caseVersionId: cv.id,
            caseId: cv.caseId,
            version: cv.version,
            repo: `${cv.repoOwner}/${cv.repoName}`,
            agents: [],
          });
        }

        const ac = agentConfigMap.get(run.agentConfigId ?? "");
        const modelId = ac
          ? String((ac.modelSettings as JsonRecord)?.["modelId"] ?? "unknown")
          : "unknown";

        const runPlan = planRows.find((p) => p.runId === run.id);
        const planScore = runPlan
          ? planScoreRows.find((ps) => ps.planId === runPlan.id)
          : undefined;
        const runEvaluation = evaluationRows.find(
          (ev) => ev.runId === run.id,
        );

        byCaseMap.get(cv.id)!.agents.push({
          agentConfigId: run.agentConfigId ?? "",
          modelId,
          runId: run.id,
          status: run.status,
          planScore: planScore ? Number(planScore.overallScore) : null,
          implScore: runEvaluation
            ? {
                resolved: runEvaluation.resolved,
                failToPass: `${runEvaluation.failToPassPassed}/${runEvaluation.failToPassTotal}`,
                passToPass: `${runEvaluation.passToPassPassed}/${runEvaluation.passToPassTotal}`,
                diffSimilarity: runEvaluation.diffSimilarityScore
                  ? Number(runEvaluation.diffSimilarityScore)
                  : null,
              }
            : null,
        });
      }

      const byCase = Array.from(byCaseMap.values());

      // Group by agent for per-agent aggregates
      const agentAggregateMap = new Map<
        string,
        {
          agentConfigId: string;
          modelId: string;
          totalRuns: number;
          completedRuns: number;
          planScores: number[];
          resolvedCount: number;
          failToPassPassed: number;
          failToPassTotal: number;
          passToPassPassed: number;
          passToPassTotal: number;
          diffSimilarityScores: number[];
        }
      >();

      for (const run of runRows) {
        const ac = agentConfigMap.get(run.agentConfigId ?? "");
        const modelId = ac
          ? String((ac.modelSettings as JsonRecord)?.["modelId"] ?? "unknown")
          : "unknown";
        const key = run.agentConfigId ?? "unknown";

        if (!agentAggregateMap.has(key)) {
          agentAggregateMap.set(key, {
            agentConfigId: key,
            modelId,
            totalRuns: 0,
            completedRuns: 0,
            planScores: [],
            resolvedCount: 0,
            failToPassPassed: 0,
            failToPassTotal: 0,
            passToPassPassed: 0,
            passToPassTotal: 0,
            diffSimilarityScores: [],
          });
        }

        const agg = agentAggregateMap.get(key)!;
        agg.totalRuns++;

        if (run.status === "succeeded") {
          agg.completedRuns++;
        }

        const runPlan = planRows.find((p) => p.runId === run.id);
        const planScore = runPlan
          ? planScoreRows.find((ps) => ps.planId === runPlan.id)
          : undefined;
        if (planScore) {
          agg.planScores.push(Number(planScore.overallScore));
        }

        const runEvaluation = evaluationRows.find(
          (ev) => ev.runId === run.id,
        );
        if (runEvaluation) {
          if (runEvaluation.resolved) agg.resolvedCount++;
          agg.failToPassPassed += runEvaluation.failToPassPassed;
          agg.failToPassTotal += runEvaluation.failToPassTotal;
          agg.passToPassPassed += runEvaluation.passToPassPassed;
          agg.passToPassTotal += runEvaluation.passToPassTotal;
          if (runEvaluation.diffSimilarityScore) {
            agg.diffSimilarityScores.push(
              Number(runEvaluation.diffSimilarityScore),
            );
          }
        }
      }

      const byAgent = Array.from(agentAggregateMap.entries()).map(
        ([, a]) => ({
          agentConfigId: a.agentConfigId,
          modelId: a.modelId,
          totalRuns: a.totalRuns,
          completedRuns: a.completedRuns,
          avgPlanScore:
            a.planScores.length > 0
              ? Number(
                  (
                    a.planScores.reduce((s, v) => s + v, 0) /
                    a.planScores.length
                  ).toFixed(4),
                )
              : null,
          resolvedRate:
            a.totalRuns > 0
              ? Number((a.resolvedCount / a.totalRuns).toFixed(4))
              : 0,
          failToPassRate:
            a.failToPassTotal > 0
              ? Number(
                  (a.failToPassPassed / a.failToPassTotal).toFixed(4),
                )
              : null,
          passToPassRate:
            a.passToPassTotal > 0
              ? Number(
                  (a.passToPassPassed / a.passToPassTotal).toFixed(4),
                )
              : null,
          avgDiffSimilarity:
            a.diffSimilarityScores.length > 0
              ? Number(
                  (
                    a.diffSimilarityScores.reduce((s, v) => s + v, 0) /
                    a.diffSimilarityScores.length
                  ).toFixed(4),
                )
              : null,
        }),
      );

      // Aggregate totals
      const allPlanScores = planScoreRows.map((ps) => Number(ps.overallScore));
      const aggregate = {
        experimentId: experiment.id,
        name: experiment.name,
        mode: experiment.mode,
        status: experiment.status,
        totalRuns: runRows.length,
        completedRuns: runRows.filter((r) => r.status === "succeeded").length,
        avgPlanScore:
          allPlanScores.length > 0
            ? Number(
                (
                  allPlanScores.reduce((s, v) => s + v, 0) /
                  allPlanScores.length
                ).toFixed(4),
              )
            : null,
        resolvedRate: runRows.length > 0
          ? Number(
              (
                evaluationRows.filter((ev) => ev.resolved).length /
                runRows.length
              ).toFixed(4),
            )
          : 0,
        avgDiffSimilarity:
          evaluationRows.filter((ev) => ev.diffSimilarityScore).length > 0
            ? Number(
                (
                  evaluationRows
                    .filter((ev) => ev.diffSimilarityScore)
                    .reduce(
                      (s, ev) => s + Number(ev.diffSimilarityScore),
                      0,
                    ) /
                  evaluationRows.filter((ev) => ev.diffSimilarityScore)
                    .length
                ).toFixed(4),
              )
            : null,
        createdAt: experiment.createdAt.toISOString(),
        startedAt: experiment.startedAt?.toISOString() ?? null,
        finishedAt: experiment.finishedAt?.toISOString() ?? null,
      };

      reply.code(200);
      return {
        experimentId: experiment.id,
        aggregate,
        byCase,
        byAgent,
      };
    },
  );

  // ──────────────────────────────
  // POST /benchmarks/:id/grade-external
  // ──────────────────────────────
  fastify.post(
    "/benchmarks/:id/grade-external",
    {
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: {
            id: { type: "string", format: "uuid" },
          },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const db = fastify.db;

      // Verify experiment exists
      const [experiment] = await db
        .select()
        .from(experiments)
        .where(eq(experiments.id, id))
        .limit(1);

      if (!experiment) {
        reply.code(404);
        return { error: "Benchmark experiment not found" };
      }

      // Fetch all runs for this experiment
      const runRows = await db
        .select({ id: runs.id, status: runs.status })
        .from(runs)
        .where(eq(runs.experimentId, experiment.id));

      // Check if all runs have completed (succeeded or failed)
      const completedRuns = runRows.filter(
        (r) => r.status === "succeeded" || r.status === "failed",
      );
      const allCompleted = completedRuns.length === runRows.length;

      if (!allCompleted) {
        reply.code(400);
        return {
          error: `Not all runs completed. ${completedRuns.length}/${runRows.length} completed`,
        };
      }

      // Check if there are at least 2 successful runs for external comparison
      const successfulRuns = runRows.filter((r) => r.status === "succeeded");
      if (successfulRuns.length < 2) {
        reply.code(400);
        return {
          error: `Need at least 2 successful runs for external comparison. Found ${successfulRuns.length}`,
        };
      }

      // Trigger external grading for all pairs of successful runs
      const externalJobs: { jobId: string; runAId: string; runBId: string }[] = [];
      for (let i = 0; i < successfulRuns.length; i++) {
        for (let j = i + 1; j < successfulRuns.length; j++) {
          const runAId = successfulRuns[i]!.id;
          const runBId = successfulRuns[j]!.id;
          
          const job = await enqueueGradingExternalJob(gradingExternalQueue, {
            experimentId: experiment.id,
            runAId,
            runBId,
          });
          
          externalJobs.push({
            jobId: job.id ?? "unknown",
            runAId,
            runBId,
          });
        }
      }

      // Update experiment status to show grading is complete
      const now = new Date();
      await db
        .update(experiments)
        .set({
          status: "succeeded",
          finishedAt: now,
          updatedAt: now,
        })
        .where(eq(experiments.id, experiment.id));

      reply.code(202);
      return {
        experimentId: experiment.id,
        status: "graded",
        externalGradingJobs: externalJobs,
        enqueuedAt: now.toISOString(),
      };
    },
  );
};

function buildDefaultPlanPrompt(input: {
  caseVersionId: string;
  issueTitle: string;
  issueBody: string;
}) {
  const issueSection =
    input.issueTitle
      ? `\n\n## GitHub Issue: ${input.issueTitle}\n\n${input.issueBody || ""}`
      : "";

  return [
    "You are running a Pi Lab plan-only benchmark.",
    `Case version: ${input.caseVersionId}.${issueSection}`,
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
          if (!title && typeof issueObj.title === "string") {
            // title from artifact, but we already prefer githubIssues.title
          }
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
