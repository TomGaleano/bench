"use client";

import { useState } from "react";
import type { PlaygroundAgentRunResponse } from "../../lib/api";

type ScoringPanelProps = {
  agentRuns: PlaygroundAgentRunResponse[];
  sessionId: string;
  graderModelId: string | null;
  onScore: (scores: Array<{ agentRunId: string; score: number; rationale?: string | undefined }>) => Promise<void>;
  onAutoGrade: () => Promise<void>;
  allCompleted: boolean;
};

export function ScoringPanel({ agentRuns, graderModelId, onScore, onAutoGrade, allCompleted }: ScoringPanelProps) {
  const [scores, setScores] = useState<Record<string, number>>({});
  const [rationales, setRationales] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [autoGrading, setAutoGrading] = useState(false);

  if (!allCompleted) {
    return (
      <section className="card2">
        <div className="card2-hd">
          <span className="card2-ti">Scoring</span>
        </div>
        <p style={{ color: "var(--ink-4)", fontStyle: "italic", fontSize: 13 }}>
          Waiting for all agents to finish…
        </p>
      </section>
    );
  }

  const alreadyScored = agentRuns.some((r) => r.score !== null);
  const scorableRuns = agentRuns.filter((r) => r.status === "succeeded" && r.output);

  async function handleSubmit() {
    setSubmitting(true);
    try {
      const payload = scorableRuns.map((r) => ({
        agentRunId: r.id,
        score: scores[r.id] ?? 50,
        ...(rationales[r.id] ? { rationale: rationales[r.id] } : {}),
      }));
      await onScore(payload);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAutoGrade() {
    setAutoGrading(true);
    try {
      await onAutoGrade();
    } finally {
      setAutoGrading(false);
    }
  }

  return (
    <section className="card2">
      <div className="card2-hd">
        <span className="card2-ti">Score Results</span>
      </div>

      {alreadyScored ? (
        <div
          style={{
            padding: "8px 0",
            display: "grid",
            gap: 12,
            gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          }}
        >
          {agentRuns.map((r) => (
            <div
              key={r.id}
              style={{
                padding: 12,
                border: "1px solid var(--border)",
                borderRadius: 6,
                background: "var(--surface)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <strong>{r.modelName}</strong>
                {r.score !== null ? (
                  <span style={{ color: "var(--accent)", fontFamily: "var(--mono)", fontSize: 12 }}>
                    {r.score}/100
                  </span>
                ) : (
                  <span style={{ color: "var(--ink-4)", fontSize: 11 }}>{r.status}</span>
                )}
              </div>
              {r.scoreRationale && (
                <p style={{ fontSize: 12, color: "var(--ink-4)", marginTop: 6, whiteSpace: "pre-wrap" }}>
                  {r.scoreRationale}
                </p>
              )}
            </div>
          ))}
        </div>
      ) : (
        <>
          <div
            style={{
              padding: "8px 0",
              display: "grid",
              gap: 16,
              gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))",
            }}
          >
            {agentRuns.map((r) => {
              const canScore = r.status === "succeeded" && r.output;
              return (
                <div
                  key={r.id}
                  style={{
                    padding: 12,
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    background: "var(--surface)",
                    opacity: canScore ? 1 : 0.55,
                  }}
                >
                  <div style={{ marginBottom: 6, display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                    <strong>{r.modelName}</strong>
                    <span
                      style={{
                        fontSize: 10,
                        color: r.status === "failed" ? "#ef4444" : "var(--ink-4)",
                        fontFamily: "var(--mono)",
                        textTransform: "uppercase",
                      }}
                    >
                      {r.status}
                    </span>
                  </div>
                  {!canScore ? (
                    <p style={{ fontSize: 12, color: "var(--ink-4)", margin: 0 }}>
                      No output to score.
                    </p>
                  ) : (
                    <>
                      <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                        <input
                          type="range"
                          min={0}
                          max={100}
                          value={scores[r.id] ?? 50}
                          onChange={(e) => setScores((prev) => ({ ...prev, [r.id]: Number(e.target.value) }))}
                          style={{ flex: 1 }}
                        />
                        <span style={{ fontFamily: "var(--mono)", fontSize: 12, minWidth: 30, textAlign: "right" }}>
                          {scores[r.id] ?? 50}
                        </span>
                      </label>
                      <textarea
                        placeholder="Optional rationale…"
                        value={rationales[r.id] ?? ""}
                        onChange={(e) => setRationales((prev) => ({ ...prev, [r.id]: e.target.value }))}
                        style={{
                          width: "100%",
                          padding: 6,
                          fontSize: 12,
                          borderRadius: 6,
                          border: "1px solid var(--border)",
                          background: "var(--surface-2, var(--surface))",
                          color: "var(--ink-2)",
                          resize: "vertical",
                          minHeight: 50,
                        }}
                        rows={2}
                      />
                    </>
                  )}
                </div>
              );
            })}
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button
              className="btn2 primary"
              disabled={submitting || scorableRuns.length === 0}
              onClick={handleSubmit}
              type="button"
            >
              {submitting ? "Saving…" : "Submit Scores"}
            </button>
            {graderModelId && (
              <button
                className="btn2"
                disabled={autoGrading || scorableRuns.length === 0}
                onClick={handleAutoGrade}
                type="button"
              >
                {autoGrading ? "Grading…" : "Auto-grade with AI"}
              </button>
            )}
            {scorableRuns.length === 0 && (
              <span style={{ color: "var(--ink-4)", fontSize: 12, alignSelf: "center" }}>
                No successful runs to score.
              </span>
            )}
          </div>
        </>
      )}
    </section>
  );
}
