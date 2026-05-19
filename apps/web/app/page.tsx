"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CostScatter } from "../components/charts/CostScatter";
import { Leaderboard } from "../components/charts/Leaderboard";
import { RaceChart } from "../components/charts/RaceChart";
import { Hero } from "../components/ui/Hero";
import { KpiStrip } from "../components/ui/KpiStrip";
import { SectionHeader } from "../components/ui/SectionHeader";
import type { MetricsOverview } from "../lib/api";
import { getMetricsOverview } from "../lib/api";
import { formatCurrency } from "../lib/format";

function deltaProps(deltaWeekPct: number) {
  if (deltaWeekPct === 0) return null;
  return {
    direction: deltaWeekPct > 0 ? ("up" as const) : ("down" as const),
    label: `${Math.abs(deltaWeekPct).toFixed(1)}% wk`,
  };
}

function pct(value: number) {
  return value > 0 ? `${value.toFixed(1)}%` : "—";
}

function elapsedLabel(ms: number) {
  if (ms <= 0) return "just started";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m elapsed`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m elapsed`;
}

export default function OverviewPage() {
  const [data, setData] = useState<MetricsOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getMetricsOverview()
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const kpis = data?.kpis;
  const active = data?.activeExperiment ?? null;
  const totalRunsThisWeek = kpis?.runs7d.value ?? 0;

  return (
    <div className="mdl-page">
      <Hero
        eyebrow="SWE-Bench Verified · v25.04"
        live={!!active}
        title={
          <>
            The frontier <em>moved</em> this week.
          </>
        }
        lede="Twelve models, hundreds of verified tasks, four harness configurations. Resolution rate, plan quality, and cost-per-resolved tracked continuously."
        meta={[
          ["Runs · 7d", totalRunsThisWeek > 0 ? String(totalRunsThisWeek) : "No data"],
          ["Spend · 7d", formatCurrency(0)],
          ["Budget", "Not set"],
        ]}
      />

      {error && (
        <div className="mdl-err" style={{ margin: "32px auto" }}>
          <h3>Couldn&apos;t load overview</h3>
          <p>{error}</p>
        </div>
      )}

      <KpiStrip
        cells={[
          {
            label: "Best E2E score",
            value: kpis?.bestE2E.modelId ? pct(kpis.bestE2E.value) : "—",
            sub: kpis?.bestE2E.modelId ?? "No model",
            delta: kpis?.bestE2E.modelId ? deltaProps(kpis.bestE2E.deltaWeekPct) : null,
            spark: kpis?.bestE2E.spark,
            sparkColor: "var(--accent)",
            sparkFill: true,
          },
          {
            label: "Best plan score",
            value: kpis?.bestPlan.modelId ? pct(kpis.bestPlan.value) : "—",
            sub: kpis?.bestPlan.modelId ?? "No model",
            delta: kpis?.bestPlan.modelId ? deltaProps(kpis.bestPlan.deltaWeekPct) : null,
            spark: kpis?.bestPlan.spark,
            sparkColor: "var(--ink)",
          },
          {
            label: "Lowest $/resolved",
            value: kpis?.lowestCostPerResolved.modelId
              ? formatCurrency(kpis.lowestCostPerResolved.value)
              : "—",
            sub: kpis?.lowestCostPerResolved.modelId ?? "No model",
            delta: kpis?.lowestCostPerResolved.modelId
              ? deltaProps(kpis.lowestCostPerResolved.deltaWeekPct)
              : null,
            spark: kpis?.lowestCostPerResolved.spark,
            sparkColor: "var(--cool)",
          },
          {
            label: "Runs · 7d",
            value: kpis ? String(kpis.runs7d.value) : "—",
            sub: kpis && kpis.runs7d.deltaWeekPct ? "vs. prior week" : "no prior data",
            delta: kpis ? deltaProps(kpis.runs7d.deltaWeekPct) : null,
            spark: kpis?.runs7d.spark,
            sparkColor: "var(--plum)",
            sparkFill: true,
          },
        ]}
      />

      <div className="overview-split">
        <section className="card2 elev">
          <div className="card2-hd" style={{ marginBottom: 6 }}>
            <span className={"tag2 " + (active ? "live" : "")}>
              {active && <span className="pip" />}
              {active ? "running" : "idle"}
            </span>
            <span style={{ color: "var(--ink-4)", fontFamily: "var(--mono)", fontSize: 11 }}>
              {active ? `${active.id.slice(0, 8)} · ${elapsedLabel(active.elapsedMs)}` : "—"}
            </span>
            <Link className="btn2" href="/runs" style={{ marginLeft: "auto" }}>
              Open monitor →
            </Link>
          </div>
          <div
            style={{
              fontFamily: "var(--serif)",
              fontSize: 28,
              fontStyle: active ? "italic" : "normal",
              letterSpacing: "-0.015em",
              marginTop: 4,
            }}
          >
            {active ? active.name : "No active experiment"}
          </div>
          <div
            style={{
              color: "var(--ink-4)",
              fontFamily: "var(--mono)",
              fontSize: 11.5,
              marginTop: 4,
            }}
          >
            {active
              ? `${active.modelsCount} models × ${active.tasksCount} tasks · ${active.harness ?? "no harness"} · ${active.done} done · ${active.active} active · ${active.queued} queued`
              : "Launch an experiment to populate this card."}
          </div>
          {active && (
            <>
              <div className="progress-stack" aria-label="Experiment progress">
                {(() => {
                  const total = Math.max(
                    1,
                    active.done + active.failed + active.active + active.queued,
                  );
                  return (
                    <>
                      <i className="done" style={{ width: `${(active.done / total) * 100}%` }} />
                      <i
                        className="failed"
                        style={{ width: `${(active.failed / total) * 100}%` }}
                      />
                      <i
                        className="active"
                        style={{ width: `${(active.active / total) * 100}%` }}
                      />
                      <i
                        className="queued"
                        style={{ width: `${(active.queued / total) * 100}%` }}
                      />
                    </>
                  );
                })()}
              </div>
              <div className="exp-fact-row">
                <span>
                  <b>{active.done}</b> done
                </span>
                <span>
                  <b style={{ color: "var(--danger)" }}>{active.failed}</b> failed
                </span>
                <span>
                  <b style={{ color: "var(--accent)" }}>{active.active}</b> active
                </span>
                <span>
                  <b style={{ color: "var(--ink-4)" }}>{active.queued}</b> queued
                </span>
                <span style={{ marginLeft: "auto" }}>
                  {formatCurrency(active.spentUsd)} /{" "}
                  {active.budgetUsd != null ? formatCurrency(active.budgetUsd) : "no cap"}
                </span>
              </div>
            </>
          )}
        </section>

        <section className="card2">
          <div className="card2-hd">
            <span className="card2-ti">Cost · accuracy frontier</span>
            <span
              style={{
                color: "var(--ink-4)",
                fontFamily: "var(--mono)",
                fontSize: 10.5,
              }}
            >
              pareto-optimal in <span style={{ color: "var(--accent)" }}>orange</span>
            </span>
          </div>
          <CostScatter
            points={
              data?.scatter.map((s) => ({
                id: s.modelId,
                label: s.modelId.split("/").pop() ?? s.modelId,
                cost: s.costPerResolved,
                score: s.e2e,
              })) ?? []
            }
          />
        </section>
      </div>

      <SectionHeader num="02">
        Six weeks of <em>frontier motion</em>
      </SectionHeader>
      <div className="card2">
        <RaceChart rows={data?.race ?? []} />
      </div>

      <SectionHeader
        num="03"
        sub="Sorted by end-to-end resolution rate. Bars within each column are normalized to that column's max."
      >
        Leaderboard <em>—</em>{" "}
        {data?.leaderboard?.length ? `${data.leaderboard.length} models` : "no rows yet"}
      </SectionHeader>
      <Leaderboard rows={data?.leaderboard ?? []} />

      <div
        style={{
          color: "var(--ink-4)",
          display: "flex",
          fontFamily: "var(--mono)",
          fontSize: 11,
          gap: 12,
          marginTop: 24,
        }}
      >
        <span>Methodology: SWE-Bench Verified · plan / implementation / e2e split.</span>
        <span style={{ marginLeft: "auto" }}>
          {data?.retrievedAt
            ? `Updated ${new Date(data.retrievedAt).toLocaleTimeString()}`
            : "Awaiting data…"}
        </span>
      </div>
    </div>
  );
}
