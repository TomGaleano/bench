"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { EmptyState, LoadingState, StatusPill } from "../../../components/ui";
import { Hero } from "../../../components/ui/Hero";
import { SectionHeader } from "../../../components/ui/SectionHeader";
import type { BenchmarkExperiment, BenchmarkRun, DurableRunEvent } from "../../../lib/api";
import { getBenchmark, getRun, getRunEvents } from "../../../lib/api";

const TABS = ["Stream", "Tests", "Diff", "Grader"] as const;
type Tab = (typeof TABS)[number];

function describeEvent(event: DurableRunEvent) {
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  if (typeof payload.delta === "string") return payload.delta;
  if (typeof payload.toolName === "string") return `Tool: ${payload.toolName}`;
  if (typeof payload.status === "string") return payload.status;
  if (typeof payload.message === "string") return payload.message;
  if (typeof payload.objectKey === "string") return payload.objectKey;
  return JSON.stringify(payload, null, 2).slice(0, 400);
}

function progressForStatus(status: string): number {
  if (status === "queued") return 15;
  if (status === "running") return 68;
  if (status === "succeeded") return 100;
  if (status === "failed" || status === "timed_out" || status === "cancelled") return 100;
  return 25;
}

function stageLabel(run: BenchmarkRun): string {
  return run.stage || run.status;
}

export default function BenchmarkLivePage() {
  const params = useParams();
  const id = params.id as string;

  const [benchmark, setBenchmark] = useState<BenchmarkExperiment | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Agent panels
  const [activeTab, setActiveTab] = useState<Tab>("Stream");
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<"agent1" | "agent2">("agent1");

  // Run events
  const [events, setEvents] = useState<DurableRunEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);

  // Fetch benchmark status
  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        const b = await getBenchmark(id);
        if (!cancelled) {
          setBenchmark(b);
          setError("");
          setLoading(false);

          if (!selectedRunId) {
            // Auto-select first agent's first case conceptually
            setSelectedAgent("agent1");
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      }
    }
    void refresh();
    const interval = window.setInterval(refresh, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [id]);

  // Fetch events when a run is selected
  useEffect(() => {
    if (!selectedRunId) {
      setEvents([]);
      return;
    }
    let cancelled = false;
    setEventsLoading(true);
    async function fetchEvents() {
      try {
        const evts = await getRunEvents(selectedRunId!);
        if (!cancelled) {
          setEvents(evts);
          setEventsLoading(false);
        }
      } catch {
        if (!cancelled) setEventsLoading(false);
      }
    }
    void fetchEvents();
    const interval = window.setInterval(fetchEvents, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [selectedRunId]);

  if (loading) {
    return (
      <div className="mdl-page">
        <LoadingState label="Loading benchmark…" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mdl-page">
        <div className="mdl-err" style={{ margin: "24px auto" }}>
          <h3>Couldn&apos;t load benchmark</h3>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  if (!benchmark) {
    return (
      <div className="mdl-page">
        <EmptyState title="Benchmark not found" description="This benchmark does not exist or was deleted." />
      </div>
    );
  }

  const isTerminal = benchmark.status === "succeeded" || benchmark.status === "failed";

  return (
    <div className="mdl-page benchmark-live">
      <Hero
        eyebrow={`Benchmark · ${benchmark.datasetName ?? benchmark.datasetSlug}`}
        live={benchmark.status === "running"}
        title={
          <>
            <em>{benchmark.name}</em>
          </>
        }
        lede={`${benchmark.completedRuns}/${benchmark.totalRuns} runs complete. Agent 1 (${benchmark.agent1ModelId?.split("/").pop() ?? "—"}) vs Agent 2 (${benchmark.agent2ModelId?.split("/").pop() ?? "—"}).`}
        meta={[
          ["Status", <StatusPill status={benchmark.status ?? "unknown"} key="s" /> as unknown as string],
          ["Cases", String(benchmark.totalCases)],
          ["Runs", `${benchmark.completedRuns}/${benchmark.totalRuns}`],
        ]}
        actions={
          <>
            <Link className="btn2" href="/benchmarks">
              ← All benchmarks
            </Link>
            {isTerminal && (
              <Link className="btn2 primary" href={`/benchmarks/${benchmark.id}/results`}>
                View results →
              </Link>
            )}
          </>
        }
      />

      {/* Progress bar */}
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 32px" }}>
        <div className="progress-track" style={{ margin: "0 0 8px" }}>
          <div
            className={"progress-fill" + (benchmark.status === "running" ? " animated" : "")}
            style={{ width: `${benchmark.totalRuns > 0 ? (benchmark.completedRuns / benchmark.totalRuns) * 100 : 0}%` }}
          />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-1)" }}>
          <span>{benchmark.completedRuns} of {benchmark.totalRuns} runs</span>
          <span>{benchmark.failedRuns > 0 ? `${benchmark.failedRuns} failed` : ""}</span>
        </div>
      </div>

      <SectionHeader num="01">
        Agent <em>split-screen</em>
      </SectionHeader>

      {/* Tab bar */}
      <div className="tab-bar" style={{ margin: "0 32px 20px" }}>
        {TABS.map((tab) => (
          <button
            key={tab}
            className={"tab-btn" + (activeTab === tab ? " active" : "")}
            onClick={() => setActiveTab(tab)}
            type="button"
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Split panel */}
      <div className="replay-split" style={{ marginTop: 0 }}>
        {/* Agent 1 Panel */}
        <section className="card2 replay-event">
          <div className="card2-hd">
            <span className="card2-ti">
              Agent 1 · {benchmark.agent1ModelId?.split("/").pop() ?? "—"}
            </span>
            <span style={{ color: "var(--ink-4)", fontFamily: "var(--mono)", fontSize: 11 }}>
              {benchmark.agent1Mode}
            </span>
          </div>

          <AgentPanelContent
            tab={activeTab}
            benchmarkId={benchmark.id}
            agent="agent1"
            runId={selectedRunId && selectedAgent === "agent1" ? selectedRunId : null}
            events={selectedAgent === "agent1" ? events : []}
            eventsLoading={selectedAgent === "agent1" ? eventsLoading : false}
            onSelectRun={(runId) => {
              setSelectedRunId(runId);
              setSelectedAgent("agent1");
            }}
          />
        </section>

        {/* Agent 2 Panel */}
        <section className="card2 replay-event">
          <div className="card2-hd">
            <span className="card2-ti">
              Agent 2 · {benchmark.agent2ModelId?.split("/").pop() ?? "—"}
            </span>
            <span style={{ color: "var(--ink-4)", fontFamily: "var(--mono)", fontSize: 11 }}>
              {benchmark.agent2Mode ?? "—"}
            </span>
          </div>

          <AgentPanelContent
            tab={activeTab}
            benchmarkId={benchmark.id}
            agent="agent2"
            runId={selectedRunId && selectedAgent === "agent2" ? selectedRunId : null}
            events={selectedAgent === "agent2" ? events : []}
            eventsLoading={selectedAgent === "agent2" ? eventsLoading : false}
            onSelectRun={(runId) => {
              setSelectedRunId(runId);
              setSelectedAgent("agent2");
            }}
          />
        </section>
      </div>
    </div>
  );
}

function AgentPanelContent({
  tab,
  agent,
  runId,
  events,
  eventsLoading,
  onSelectRun,
}: {
  tab: Tab;
  benchmarkId: string;
  agent: "agent1" | "agent2";
  runId: string | null;
  events: DurableRunEvent[];
  eventsLoading: boolean;
  onSelectRun: (runId: string) => void;
}) {
  if (tab === "Stream") {
    return (
      <div>
        {!runId ? (
          <p style={{ color: "var(--ink-4)", fontStyle: "italic", padding: 16 }}>
            Waiting for runs to start…
          </p>
        ) : (
          <>
            <div className="shell" style={{ marginBottom: 12 }}>
              <div className="shell-header">
                <div className="shell-dot red" />
                <div className="shell-dot yellow" />
                <div className="shell-dot green" />
                <span className="shell-title">pi-harness · {agent}</span>
              </div>
              <div className="shell-body">
                {eventsLoading && events.length === 0 ? (
                  <div className="dim">Loading stream…</div>
                ) : events.length === 0 ? (
                  <div className="dim">No events yet. Stream will appear as the agent works.</div>
                ) : (
                  events.slice(-40).map((e) => (
                    <div
                      key={e.id}
                      className="stream-line"
                      style={{
                        color:
                          e.kind.includes("error") || e.kind.includes("fail")
                            ? "var(--error)"
                            : e.kind === "tool_call"
                              ? "var(--accent)"
                              : "var(--ink-1)",
                        marginBottom: 2,
                      }}
                    >
                      <span style={{ color: "var(--ink-2)", opacity: 0.6, marginRight: 4 }}>
                        [{e.seq}]
                      </span>
                      {describeEvent(e)}
                    </div>
                  ))
                )}
                {eventsLoading && <span className="cursor" />}
              </div>
            </div>

            {/* Progress for current run */}
            <RunProgress events={events} />
          </>
        )}
      </div>
    );
  }

  if (tab === "Tests") {
    return (
      <div style={{ padding: 16 }}>
        <p style={{ color: "var(--ink-4)", fontStyle: "italic" }}>
          Test results will appear after implementation completes.
        </p>
        {/* Placeholder test table */}
        <table className="mdl-table" style={{ marginTop: 12 }}>
          <thead>
            <tr>
              <th>Test</th>
              <th>Result</th>
              <th>Time</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ color: "var(--ink-1)" }} colSpan={3}>
                No test results yet…
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    );
  }

  if (tab === "Diff") {
    return (
      <div style={{ padding: 16 }}>
        <p style={{ color: "var(--ink-4)", fontStyle: "italic" }}>
          Patch diff will appear after implementation completes.
        </p>
      </div>
    );
  }

  if (tab === "Grader") {
    return (
      <div style={{ padding: 16 }}>
        <p style={{ color: "var(--ink-4)", fontStyle: "italic" }}>
          Grader verdict will appear after all runs complete.
        </p>
      </div>
    );
  }

  return null;
}

function RunProgress({ events }: { events: DurableRunEvent[] }) {
  const stages = useMemo(() => {
    const seen = new Set<string>();
    for (const e of events) {
      if (e.stage) seen.add(e.stage);
    }
    return Array.from(seen);
  }, [events]);

  if (stages.length === 0) return null;

  return (
    <div style={{ padding: "0 4px" }}>
      <div style={{ fontFamily: "var(--mono)", fontSize: 10, textTransform: "uppercase", color: "var(--ink-1)", marginBottom: 6 }}>
        Stages
      </div>
      <div className="mdl-tags" style={{ gap: 4 }}>
        {stages.map((s) => (
          <span key={s} className="mdl-tag">{s.replace(/_/g, " ")}</span>
        ))}
      </div>
    </div>
  );
}
