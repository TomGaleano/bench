"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { EmptyState, LoadingState, StatusPill } from "../../../../components/ui";
import { Hero } from "../../../../components/ui/Hero";
import { SectionHeader } from "../../../../components/ui/SectionHeader";
import type { BenchmarkResults, DurableRunEvent } from "../../../../lib/api";
import { getBenchmarkResults } from "../../../../lib/api";

const CONFETTI_COLORS = ["#6366f1", "#fbbf24", "#22c55e", "#ef4444", "#a5b4fc", "#f59e0b", "#818cf8", "#86efac"];

function fireConfetti() {
  for (let i = 0; i < 80; i++) {
    const el = document.createElement("div");
    el.style.cssText = `
      position: fixed;
      width: 8px; height: 8px;
      border-radius: 2px;
      animation: confetti 3s ease-out forwards;
      z-index: 200;
      pointer-events: none;
      left: ${Math.random() * 100}vw;
      top: 100vh;
      background: ${CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)]};
      animation-duration: ${2 + Math.random() * 2}s;
      animation-delay: ${Math.random() * 0.5}s;
      transform: rotate(${Math.random() * 360}deg);
    `;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 5000);
  }
}

function scoreColor(score: number | null | undefined): string {
  if (score == null) return "var(--ink-1)";
  if (score >= 8) return "var(--success)";
  if (score >= 5) return "var(--warn)";
  return "var(--error)";
}

function formatScore(score: number | null | undefined): string {
  if (score == null) return "—";
  return score.toFixed(1);
}

export default function BenchmarkResultsPage() {
  const params = useParams();
  const id = params.id as string;

  const [results, setResults] = useState<BenchmarkResults | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [confettiFired, setConfettiFired] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await getBenchmarkResults(id);
        if (!cancelled) {
          setResults(r);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      }
    }
    void load();
    const interval = window.setInterval(load, 8000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [id]);

  // Fire confetti on results load
  useEffect(() => {
    if (results && !confettiFired) {
      setConfettiFired(true);
      setTimeout(fireConfetti, 400);
    }
  }, [results, confettiFired]);

  if (loading) {
    return (
      <div className="mdl-page">
        <LoadingState label="Loading results…" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mdl-page">
        <div className="mdl-err" style={{ margin: "24px auto" }}>
          <h3>Couldn&apos;t load results</h3>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  if (!results) {
    return (
      <div className="mdl-page">
        <EmptyState title="No results yet" description="Results will appear once the benchmark finishes running." />
      </div>
    );
  }

  const a1 = results.agent1;
  const a2 = results.agent2;
  const winner = results.winner;

  const a1Total = a1.totalScore ?? 0;
  const a2Total = a2.totalScore ?? 0;
  const maxScore = Math.max(a1Total, a2Total, 0.1);

  return (
    <div className="mdl-page benchmark-results">
      <Hero
        eyebrow={`Results · ${results.datasetSlug}`}
        title={
          <>
            <em>{results.name}</em>
          </>
        }
        lede={`Benchmark complete. ${a1.resolvedCases + a2.resolvedCases} resolved across ${a1.totalCases + a2.totalCases} attempts.`}
        meta={[
          ["Status", results.status],
          ["Winner", winner ? (winner === "tie" ? "Tie" : winner === "agent1" ? "Agent 1" : "Agent 2") : "Pending"],
        ]}
        actions={
          <>
            <Link className="btn2" href={`/benchmarks/${id}`}>
              ← Live view
            </Link>
            <button className="btn2 primary" onClick={fireConfetti} type="button">
              Celebrate 🎉
            </button>
            <Link className="btn2" href="/benchmarks/new">
              Run again →
            </Link>
          </>
        }
      />

      {/* Podium */}
      <SectionHeader num="01">
        Final <em>podium</em>
      </SectionHeader>

      <div className="podium" style={{ maxWidth: 600, margin: "0 auto", padding: "40px 0", display: "flex", alignItems: "flex-end", justifyContent: "center", gap: 24, minHeight: 320 }}>
        {/* Silver (agent 2 or runner-up) */}
        <div
          className="podium-block"
          style={{
            order: winner === "agent1" ? 1 : 2,
            animation: "fadeUp 0.7s cubic-bezier(0.22, 1, 0.36, 1) both",
            animationDelay: "0.2s",
            opacity: 0,
          }}
        >
          <div
            className="podium-avatar silver"
            style={{
              background: a1Total >= a2Total ? "linear-gradient(135deg, #94a3b8, #64748b)" : "linear-gradient(135deg, #fbbf24, #f59e0b)",
            }}
          >
            {a1Total >= a2Total ? "A2" : "A1"}
          </div>
          <div
            className="podium-bar"
            style={{
              height: `${Math.max(60, (Math.min(a1Total, a2Total) / maxScore) * 200)}px`,
              background: a1Total >= a2Total
                ? "linear-gradient(180deg, #94a3b8, #64748b)"
                : "linear-gradient(180deg, #fbbf24, #f59e0b)",
              width: 120,
              borderRadius: "8px 8px 0 0",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "flex-end",
              paddingBottom: 16,
              color: "#fff",
              fontFamily: "var(--font-mono)",
              position: "relative" as const,
              overflow: "hidden",
            }}
          >
            <div style={{ position: "absolute", top: 12, fontSize: 32, fontWeight: 700, opacity: 0.2 }}>
              {a1Total >= a2Total ? 2 : 1}
            </div>
            <div style={{ fontSize: 28, fontWeight: 600, lineHeight: 1 }}>
              {formatScore(Math.min(a1Total, a2Total))}
            </div>
            <div style={{ fontSize: 11, opacity: 0.9, marginTop: 4 }}>
              {a1Total >= a2Total
                ? (a2.mode ?? "end-to-end")
                : (a1.mode ?? "end-to-end")}
            </div>
            <div style={{ fontSize: 10, opacity: 0.7, marginTop: 2 }}>
              {(a1Total >= a2Total ? a2.modelId : a1.modelId)?.split("/").pop() ?? "—"}
            </div>
          </div>
        </div>

        {/* Gold (winner) */}
        <div
          className="podium-block"
          style={{
            order: winner === "agent1" ? 2 : 1,
            animation: "fadeUp 0.7s cubic-bezier(0.22, 1, 0.36, 1) both",
            animationDelay: "0.1s",
            opacity: 0,
          }}
        >
          <div
            className="podium-avatar gold"
            style={{
              background: a1Total >= a2Total ? "linear-gradient(135deg, #fbbf24, #f59e0b)" : "linear-gradient(135deg, #94a3b8, #64748b)",
            }}
          >
            {a1Total >= a2Total ? "A1" : "A2"}
          </div>
          <div
            className="podium-bar"
            style={{
              height: `${Math.max(80, (Math.max(a1Total, a2Total) / maxScore) * 200)}px`,
              background: a1Total >= a2Total
                ? "linear-gradient(180deg, #fbbf24, #f59e0b)"
                : "linear-gradient(180deg, #94a3b8, #64748b)",
              width: 120,
              borderRadius: "8px 8px 0 0",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "flex-end",
              paddingBottom: 16,
              color: "#fff",
              fontFamily: "var(--font-mono)",
              position: "relative" as const,
              overflow: "hidden",
            }}
          >
            <div style={{ position: "absolute", top: 12, fontSize: 32, fontWeight: 700, opacity: 0.2 }}>
              {a1Total >= a2Total ? 1 : 2}
            </div>
            <div style={{ fontSize: 28, fontWeight: 600, lineHeight: 1 }}>
              {formatScore(Math.max(a1Total, a2Total))}
            </div>
            <div style={{ fontSize: 11, opacity: 0.9, marginTop: 4 }}>
              {a1Total >= a2Total
                ? (a1.mode ?? "end-to-end")
                : (a2.mode ?? "end-to-end")}
            </div>
            <div style={{ fontSize: 10, opacity: 0.7, marginTop: 2 }}>
              {(a1Total >= a2Total ? a1.modelId : a2.modelId)?.split("/").pop() ?? "—"}
            </div>
          </div>
        </div>
      </div>

      {/* Score breakdown table */}
      <SectionHeader num="02">
        Score <em>breakdown</em>
      </SectionHeader>

      <div className="card2" style={{ maxWidth: 900, margin: "0 auto 40px" }}>
        <table className="mdl-table">
          <thead>
            <tr>
              <th>Agent</th>
              <th style={{ width: 100 }} className="num">Plan score</th>
              <th style={{ width: 100 }} className="num">Impl score</th>
              <th style={{ width: 100 }} className="num">Tests</th>
              <th style={{ width: 100 }} className="num">Grader</th>
              <th style={{ width: 100 }} className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <div className="mdl-name">
                  <div className="ti">{a1.modelId?.split("/").pop() ?? "Agent 1"}</div>
                  <div className="id">{a1.modelId}</div>
                </div>
              </td>
              <td>
                <span style={{ color: scoreColor(a1.planScore), fontFamily: "var(--mono)" }}>
                  {formatScore(a1.planScore)}
                </span>
              </td>
              <td>
                <span style={{ color: scoreColor(a1.implScore), fontFamily: "var(--mono)" }}>
                  {formatScore(a1.implScore)}
                </span>
              </td>
              <td>
                <span style={{ color: scoreColor(a1.testScore), fontFamily: "var(--mono)" }}>
                  {a1.resolvedCases}/{a1.totalCases}
                </span>
              </td>
              <td>
                <StatusPill status={a1.graderVerdict ?? "pending"} />
              </td>
              <td>
                <strong style={{ fontFamily: "var(--mono)", fontSize: 14 }}>
                  {formatScore(a1.totalScore)}
                </strong>
              </td>
            </tr>
            <tr>
              <td>
                <div className="mdl-name">
                  <div className="ti">{a2.modelId?.split("/").pop() ?? "Agent 2"}</div>
                  <div className="id">{a2.modelId}</div>
                </div>
              </td>
              <td>
                <span style={{ color: scoreColor(a2.planScore), fontFamily: "var(--mono)" }}>
                  {formatScore(a2.planScore)}
                </span>
              </td>
              <td>
                <span style={{ color: scoreColor(a2.implScore), fontFamily: "var(--mono)" }}>
                  {formatScore(a2.implScore)}
                </span>
              </td>
              <td>
                <span style={{ color: scoreColor(a2.testScore), fontFamily: "var(--mono)" }}>
                  {a2.resolvedCases}/{a2.totalCases}
                </span>
              </td>
              <td>
                <StatusPill status={a2.graderVerdict ?? "pending"} />
              </td>
              <td>
                <strong style={{ fontFamily: "var(--mono)", fontSize: 14 }}>
                  {formatScore(a2.totalScore)}
                </strong>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Per-case results */}
      {results.perCase.length > 0 && (
        <>
          <SectionHeader num="03">
            Per-case <em>results</em>
          </SectionHeader>

          <div className="card2" style={{ maxWidth: 900, margin: "0 auto 40px" }}>
            <table className="mdl-table">
              <thead>
                <tr>
                  <th>Case</th>
                  <th style={{ width: 120 }}>Agent 1</th>
                  <th style={{ width: 120 }}>Agent 2</th>
                  <th style={{ width: 90 }}>Winner</th>
                </tr>
              </thead>
              <tbody>
                {results.perCase.map((c) => (
                  <tr key={c.caseId}>
                    <td>
                      <div className="mdl-name">
                        <div className="ti">{c.caseTitle}</div>
                        <div className="id">{c.caseId.slice(0, 8)}</div>
                      </div>
                    </td>
                    <td>
                      <StatusPill status={c.agent1Status} />
                      {c.agent1PlanScore != null && (
                        <span style={{ fontSize: 11, color: "var(--ink-1)", marginLeft: 6 }}>
                          {formatScore(c.agent1PlanScore)}
                        </span>
                      )}
                    </td>
                    <td>
                      <StatusPill status={c.agent2Status} />
                      {c.agent2PlanScore != null && (
                        <span style={{ fontSize: 11, color: "var(--ink-1)", marginLeft: 6 }}>
                          {formatScore(c.agent2PlanScore)}
                        </span>
                      )}
                    </td>
                    <td>
                      {c.winner ? (
                        <StatusPill status={c.winner === "agent1" ? "Agent 1" : c.winner === "agent2" ? "Agent 2" : "Tie"} />
                      ) : (
                        <span style={{ color: "var(--ink-1)" }}>—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Artifact gallery */}
      <SectionHeader num="04">
        Artifact <em>gallery</em>
      </SectionHeader>

      <div className="grid-2" style={{ maxWidth: 900, margin: "0 auto" }}>
        <div>
          <div style={{ fontFamily: "var(--mono)", fontSize: 11, textTransform: "uppercase", color: "var(--ink-1)", marginBottom: 12 }}>
            Agent 1 · {a1.modelId?.split("/").pop() ?? "—"}
          </div>
          <div className="artifact-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 8 }}>
            <div className="artifact-tile">
              <div className="icon" style={{ width: 32, height: 32, borderRadius: 6, background: "var(--accent-wash)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, marginBottom: 8 }}>📄</div>
              <div className="name" style={{ fontFamily: "var(--mono)", fontSize: 11, fontWeight: 500 }}>plan.md</div>
              <div className="meta" style={{ fontSize: 11, color: "var(--ink-1)" }}>Plan score: {formatScore(a1.planScore)}</div>
            </div>
            <div className="artifact-tile">
              <div className="icon" style={{ width: 32, height: 32, borderRadius: 6, background: "var(--accent-wash)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, marginBottom: 8 }}>📦</div>
              <div className="name" style={{ fontFamily: "var(--mono)", fontSize: 11, fontWeight: 500 }}>patch.diff</div>
              <div className="meta" style={{ fontSize: 11, color: "var(--ink-1)" }}>Impl score: {formatScore(a1.implScore)}</div>
            </div>
            <div className="artifact-tile">
              <div className="icon" style={{ width: 32, height: 32, borderRadius: 6, background: "var(--accent-wash)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, marginBottom: 8 }}>📊</div>
              <div className="name" style={{ fontFamily: "var(--mono)", fontSize: 11, fontWeight: 500 }}>test-results.json</div>
              <div className="meta" style={{ fontSize: 11, color: "var(--ink-1)" }}>{a1.resolvedCases}/{a1.totalCases} resolved</div>
            </div>
          </div>
        </div>

        <div>
          <div style={{ fontFamily: "var(--mono)", fontSize: 11, textTransform: "uppercase", color: "var(--ink-1)", marginBottom: 12 }}>
            Agent 2 · {a2.modelId?.split("/").pop() ?? "—"}
          </div>
          <div className="artifact-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 8 }}>
            <div className="artifact-tile">
              <div className="icon" style={{ width: 32, height: 32, borderRadius: 6, background: "var(--accent-wash)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, marginBottom: 8 }}>📄</div>
              <div className="name" style={{ fontFamily: "var(--mono)", fontSize: 11, fontWeight: 500 }}>plan.md</div>
              <div className="meta" style={{ fontSize: 11, color: "var(--ink-1)" }}>Plan score: {formatScore(a2.planScore)}</div>
            </div>
            <div className="artifact-tile">
              <div className="icon" style={{ width: 32, height: 32, borderRadius: 6, background: "var(--accent-wash)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, marginBottom: 8 }}>📦</div>
              <div className="name" style={{ fontFamily: "var(--mono)", fontSize: 11, fontWeight: 500 }}>patch.diff</div>
              <div className="meta" style={{ fontSize: 11, color: "var(--ink-1)" }}>Impl score: {formatScore(a2.implScore)}</div>
            </div>
            <div className="artifact-tile">
              <div className="icon" style={{ width: 32, height: 32, borderRadius: 6, background: "var(--accent-wash)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, marginBottom: 8 }}>📊</div>
              <div className="name" style={{ fontFamily: "var(--mono)", fontSize: 11, fontWeight: 500 }}>test-results.json</div>
              <div className="meta" style={{ fontSize: 11, color: "var(--ink-1)" }}>{a2.resolvedCases}/{a2.totalCases} resolved</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
