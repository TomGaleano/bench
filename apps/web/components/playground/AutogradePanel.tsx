"use client";

import { useMemo, useState } from "react";
import type {
  ModelInfo,
  PlaygroundAgentRunResponse,
  PlaygroundAutograderRunResponse,
} from "../../lib/api";
import { pgVendor } from "../../lib/playground-vendor";

type AutogradePanelProps = {
  prompt: string;
  agentRuns: PlaygroundAgentRunResponse[];
  autograders: PlaygroundAutograderRunResponse[];
  primaryGraderId: string;
  models: ModelInfo[];
  onGrade: (graderIds: string[]) => void;
  onChangePrimary: (graderId: string) => void;
  isGrading: boolean;
};

const SUGGESTED_GRADERS = [
  "anthropic/claude-haiku-4",
  "openai/gpt-4o-mini",
  "google/gemini-2.0-flash-exp",
];

export function AutogradePanel({
  prompt,
  agentRuns,
  autograders,
  primaryGraderId,
  models,
  onGrade,
  onChangePrimary,
  isGrading,
}: AutogradePanelProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [extraGraders, setExtraGraders] = useState<string[]>([]);

  const primaryModel = models.find((m) => m.id === primaryGraderId);

  const primaryRun = autograders.find((r) => r.status === "completed") ?? autograders[0];
  const primaryScores = primaryRun?.scores ?? [];

  const consensusRows = useMemo(() => {
    return SUGGESTED_GRADERS.map((id) => {
      const used = autograders.some((r) => r.graderModelId === id);
      const selected = extraGraders.includes(id) || id === primaryGraderId;
      const model = models.find((m) => m.id === id);
      return { id, name: model?.name ?? id, used, selected };
    });
  }, [autograders, extraGraders, models, primaryGraderId]);

  function toggleExtra(id: string) {
    if (id === primaryGraderId) return;
    setExtraGraders((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function runMulti() {
    const ids = Array.from(new Set([primaryGraderId, ...extraGraders]));
    onGrade(ids);
  }

  return (
    <div className="pg-autograde">
      <div className="pg-autograde-hd">
        <span className="badge">autograder</span>
        <span className="ti">
          AI verdict — {primaryModel?.name ?? primaryGraderId} vs. you
        </span>
        <span className="pg-spacer" />
        <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-4)" }}>
          {primaryRun?.latencyMs ? `${(primaryRun.latencyMs / 1000).toFixed(1)} s · ` : ""}
          {autograders.length > 0
            ? `${autograders.length} grader run${autograders.length === 1 ? "" : "s"}`
            : "not graded yet"}
        </span>
        <button
          type="button"
          className="btn2"
          onClick={() => setPickerOpen((v) => !v)}
          aria-expanded={pickerOpen}
        >
          {pickerOpen ? "Done" : "Re-grade with…"}
        </button>
      </div>

      <div className="pg-autograde-bd">
        <div className="pg-autograde-grader">
          <div className="field">
            <span className="lab">Grader model</span>
            <div className="pg-autograde-grader-pick">
              <span
                className="pg-vendor-dot"
                style={{ background: pgVendor(primaryGraderId) }}
              />
              <div className="info">
                <div className="nm">{primaryModel?.name ?? primaryGraderId}</div>
                <div className="id">{primaryGraderId}</div>
              </div>
            </div>
            {pickerOpen && (
              <input
                value={primaryGraderId}
                onChange={(e) => onChangePrimary(e.target.value)}
                placeholder="anthropic/claude-haiku-4"
                style={{
                  marginTop: 6,
                  fontFamily: "var(--mono)",
                  fontSize: 12.5,
                  padding: "7px 10px",
                  border: "1px solid var(--rule-2)",
                  borderRadius: 6,
                  color: "var(--ink)",
                  background: "var(--paper)",
                  outline: "none",
                }}
              />
            )}
            <div style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--ink-4)", lineHeight: 1.5 }}>
              Fast & cheap by default. Swap to a frontier model for editorial judgments.
            </div>
          </div>

          <div className="field">
            <span className="lab">Multi-grader consensus</span>
            <div className="pg-autograde-consensus">
              {consensusRows.map((row) => (
                <div key={row.id} className="row">
                  <span
                    className="pg-vendor-dot"
                    style={{ background: pgVendor(row.id), width: 8, height: 8 }}
                  />
                  <span style={{ color: row.selected ? "var(--ink-2)" : "var(--ink-4)" }}>
                    {row.name}
                  </span>
                  {row.id === primaryGraderId ? (
                    <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--accent)" }}>
                      primary
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => toggleExtra(row.id)}
                      style={{
                        fontFamily: "var(--mono)",
                        fontSize: 10,
                        color: row.selected ? "var(--ok)" : "var(--ink-5)",
                        background: "transparent",
                        border: "none",
                        padding: 0,
                        cursor: "pointer",
                      }}
                    >
                      {row.selected ? "used" : "add"}
                    </button>
                  )}
                </div>
              ))}
            </div>
            <div style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--ink-4)" }}>
              Adds another grader run per selection. Median + spread shown when ≥ 2 graders.
            </div>
            <button
              type="button"
              className="btn2 primary"
              disabled={isGrading}
              onClick={runMulti}
              style={{ marginTop: 8 }}
            >
              {isGrading ? "Grading…" : extraGraders.length > 0 ? `Run ${extraGraders.length + 1} graders` : "Re-run primary"}
            </button>
          </div>
        </div>

        <div>
          <div className="pg-rubric-preview">
            <span className="key">System:</span> You are evaluating how well an AI coding agent completed a task. For each agent, return JSON with{" "}
            <span className="key">correctness · code_quality · ux · ship_it</span> on a 1–5 scale plus an overall 0–100 score and a 1-sentence rationale.{"\n"}
            <span className="key">User task:</span> {truncate(prompt, 160)}{"\n"}
            <span className="key">Agent outputs:</span> &lt;file tree + final message + transcript excerpt for each of {agentRuns.length} agents&gt;
          </div>
          <div
            style={{
              padding: "6px 18px 0",
              fontFamily: "var(--mono)",
              fontSize: 10,
              color: "var(--ink-4)",
              textTransform: "uppercase",
              letterSpacing: "0.07em",
              display: "flex",
              justifyContent: "space-between",
            }}
          >
            <span>↑ exact prompt sent to grader</span>
          </div>

          <div className="pg-autograde-scores">
            <table>
              <thead>
                <tr>
                  <th>Agent</th>
                  <th style={{ textAlign: "right" }}>Your overall</th>
                  <th style={{ textAlign: "right" }}>AI overall</th>
                  <th style={{ textAlign: "right" }}>Δ</th>
                  <th>AI sub-scores · C / Q / U / S</th>
                </tr>
              </thead>
              <tbody>
                {agentRuns.map((run) => {
                  const aiScore = primaryScores.find((s) => s.agentRunId === run.id);
                  const human = run.score;
                  const ai = aiScore?.overall ?? null;
                  const delta = human != null && ai != null ? human - ai : null;
                  const diverged = delta != null && Math.abs(delta) > 20;
                  const failed = run.status === "failed";
                  return (
                    <tr key={run.id}>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span
                            className="pg-vendor-dot"
                            style={{ background: pgVendor(run.modelId), width: 8, height: 8 }}
                          />
                          <span className="nm-cell">{run.modelName}</span>
                        </div>
                      </td>
                      <td style={{ textAlign: "right" }}>{human ?? "—"}</td>
                      <td style={{ textAlign: "right" }}>{ai ?? "—"}</td>
                      <td style={{ textAlign: "right" }}>
                        {failed || delta == null ? (
                          <span style={{ color: "var(--ink-5)" }}>—</span>
                        ) : diverged ? (
                          <span className="diverge">
                            Δ {delta} · divergence
                          </span>
                        ) : (
                          <span style={{ color: "var(--ink-3)" }}>
                            {delta >= 0 ? "+" : ""}
                            {delta}
                          </span>
                        )}
                      </td>
                      <td>
                        {aiScore && aiScore.correctness != null ? (
                          <>
                            <SubScore label="C" v={aiScore.correctness} />
                            <SubScore label="Q" v={aiScore.codeQuality} />
                            <SubScore label="U" v={aiScore.ux} />
                            <SubScore label="S" v={aiScore.shipIt} />
                          </>
                        ) : (
                          <span style={{ color: "var(--ink-5)" }}>
                            {failed ? "skipped — no output" : "not graded yet"}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function SubScore({ label, v }: { label: string; v: number | null }) {
  return (
    <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-2)", marginRight: 8 }}>
      <span style={{ color: "var(--ink-4)" }}>{label}</span> {v ?? "—"}
    </span>
  );
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}
