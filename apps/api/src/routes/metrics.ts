import { and, gte, sql } from "drizzle-orm";
import { runs } from "@pilab/db/schema";
import type { FastifyPluginAsync } from "fastify";

export type KpiCellPayload = {
  value: number;
  modelId: string | null;
  deltaWeekPct: number;
  spark: number[];
};

export type ActiveExperimentPayload = {
  id: string;
  name: string;
  modelsCount: number;
  tasksCount: number;
  harness: string | null;
  done: number;
  failed: number;
  active: number;
  queued: number;
  spentUsd: number;
  budgetUsd: number | null;
  elapsedMs: number;
} | null;

export type RaceRow = {
  modelId: string;
  short: string;
  trend: number[];
};

export type ScatterRow = {
  modelId: string;
  costPerResolved: number;
  e2e: number;
};

export type LeaderboardRow = {
  rank: number;
  modelId: string;
  harness: string | null;
  plan: number;
  impl: number;
  e2e: number;
  costPerTask: number;
  costPerResolved: number;
  trend6w: number[];
  deltaWeekPct: number;
};

export type MetricsOverview = {
  retrievedAt: string;
  kpis: {
    bestE2E: KpiCellPayload;
    bestPlan: KpiCellPayload;
    lowestCostPerResolved: KpiCellPayload;
    runs7d: KpiCellPayload;
  };
  activeExperiment: ActiveExperimentPayload;
  race: RaceRow[];
  scatter: ScatterRow[];
  leaderboard: LeaderboardRow[];
};

const EMPTY_KPI: KpiCellPayload = {
  value: 0,
  modelId: null,
  deltaWeekPct: 0,
  spark: [],
};

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export const metricsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Reply: MetricsOverview }>("/metrics/overview", async () => {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * DAY_MS);
    const twoWeekAgo = new Date(now.getTime() - 14 * DAY_MS);

    const recent = await fastify.db
      .select({
        createdAt: runs.createdAt,
        status: runs.status,
      })
      .from(runs)
      .where(gte(runs.createdAt, twoWeekAgo));

    let runsThisWeek = 0;
    let runsLastWeek = 0;
    const dayBuckets: number[] = Array(7).fill(0);
    const startToday = startOfDay(now).getTime();

    for (const row of recent) {
      const ts = row.createdAt.getTime();
      if (ts >= weekAgo.getTime()) {
        runsThisWeek++;
        const dayIdx = Math.floor((ts - (startToday - 6 * DAY_MS)) / DAY_MS);
        if (dayIdx >= 0 && dayIdx < 7) dayBuckets[dayIdx] = (dayBuckets[dayIdx] ?? 0) + 1;
      } else {
        runsLastWeek++;
      }
    }

    let runsDelta = 0;
    if (runsThisWeek === 0 && runsLastWeek === 0) {
      runsDelta = 0;
    } else if (runsLastWeek === 0) {
      runsDelta = 100;
    } else {
      runsDelta = Math.round(((runsThisWeek - runsLastWeek) / runsLastWeek) * 1000) / 10;
    }

    const runsKpi: KpiCellPayload = {
      value: runsThisWeek,
      modelId: null,
      deltaWeekPct: runsDelta,
      spark: dayBuckets,
    };

    // Find the latest non-terminal run as "active experiment" placeholder.
    const activeRows = await fastify.db
      .select({
        id: runs.id,
        mode: runs.mode,
        status: runs.status,
        modelId: runs.openRouterModelId,
        createdAt: runs.createdAt,
        startedAt: runs.startedAt,
      })
      .from(runs)
      .where(
        and(
          sql`${runs.status} IN ('queued','preparing','running')`,
          gte(runs.createdAt, weekAgo),
        ),
      )
      .orderBy(sql`${runs.createdAt} DESC`)
      .limit(1);

    const active = activeRows[0] ?? null;
    let activeExperiment: ActiveExperimentPayload = null;
    if (active) {
      const since = active.startedAt ?? active.createdAt;
      activeExperiment = {
        id: active.id,
        name: `${active.mode} · ${active.modelId ?? "unknown"}`,
        modelsCount: 1,
        tasksCount: 1,
        harness: null,
        done: active.status === "succeeded" ? 1 : 0,
        failed: 0,
        active: active.status === "running" ? 1 : 0,
        queued: active.status === "queued" ? 1 : 0,
        spentUsd: 0,
        budgetUsd: null,
        elapsedMs: Math.max(0, now.getTime() - since.getTime()),
      };
    }

    const payload: MetricsOverview = {
      retrievedAt: now.toISOString(),
      kpis: {
        bestE2E: EMPTY_KPI,
        bestPlan: EMPTY_KPI,
        lowestCostPerResolved: EMPTY_KPI,
        runs7d: runsKpi,
      },
      activeExperiment,
      race: [],
      scatter: [],
      leaderboard: [],
    };

    return payload;
  });
};
