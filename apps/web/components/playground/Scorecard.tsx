"use client";

import { useEffect, useMemo, useState } from "react";
import type { PlaygroundAgentRunResponse } from "../../lib/api";

export type RubricKey = "correctness" | "codeQuality" | "ux" | "shipIt";

export type ScorecardValue = {
  agentRunId: string;
  correctness: number;
  codeQuality: number;
  ux: number;
  shipIt: number;
  overall: number;
  rationale: string;
};

const RUBRIC_LABELS: Array<{ key: RubricKey; label: string }> = [
  { key: "correctness", label: "Correctness" },
  { key: "codeQuality", label: "Code quality" },
  { key: "ux", label: "UX · polish" },
  { key: "shipIt", label: "Would ship it" },
];

const WEIGHTS: Record<RubricKey, number> = {
  correctness: 0.4,
  codeQuality: 0.25,
  ux: 0.15,
  shipIt: 0.2,
};

type ScorecardProps = {
  agentRun: PlaygroundAgentRunResponse;
  blindLabel: string | null;
  value?: ScorecardValue;
  onChange: (next: ScorecardValue) => void;
  readOnly?: boolean;
};

export function Scorecard({ agentRun, blindLabel, value, onChange, readOnly }: ScorecardProps) {
  const failed = agentRun.status === "failed";
  const initial = useMemo<ScorecardValue>(() => {
    if (value) return value;
    return {
      agentRunId: agentRun.id,
      correctness: agentRun.scoreCorrectness ?? 3,
      codeQuality: agentRun.scoreCodeQuality ?? 3,
      ux: agentRun.scoreUx ?? 3,
      shipIt: agentRun.scoreShipIt ?? 3,
      overall: agentRun.score ?? 50,
      rationale: agentRun.scoreRationale ?? "",
    };
  }, [value, agentRun]);

  const [local, setLocal] = useState<ScorecardValue>(initial);
  const [overrideOverall, setOverrideOverall] = useState<boolean>(agentRun.score !== null);

  useEffect(() => {
    setLocal(initial);
  }, [initial]);

  const derived = useMemo(
    () =>
      Math.round(
        20 *
          (local.correctness * WEIGHTS.correctness +
            local.codeQuality * WEIGHTS.codeQuality +
            local.ux * WEIGHTS.ux +
            local.shipIt * WEIGHTS.shipIt),
      ),
    [local],
  );

  const displayOverall = overrideOverall ? local.overall : derived;

  function update(next: Partial<ScorecardValue>, didOverride?: boolean) {
    const merged: ScorecardValue = { ...local, ...next };
    if (didOverride) {
      setOverrideOverall(true);
    } else if (next.overall === undefined && !overrideOverall) {
      // Recompute overall from sub-scores when user hasn't manually overridden.
      merged.overall = Math.round(
        20 *
          (merged.correctness * WEIGHTS.correctness +
            merged.codeQuality * WEIGHTS.codeQuality +
            merged.ux * WEIGHTS.ux +
            merged.shipIt * WEIGHTS.shipIt),
      );
    }
    setLocal(merged);
    onChange(merged);
  }

  if (failed) {
    return (
      <div className="pg-scorecard dim">
        <div className="pg-scorecard-hd">
          <div>
            <div className="nm">{blindLabel ?? agentRun.modelName}</div>
            <div style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--err)", marginTop: 2 }}>
              ● run failed
            </div>
          </div>
          <div className="overall" style={{ color: "var(--ink-5)" }}>
            —<span className="of">/100</span>
          </div>
        </div>
        <div
          style={{
            fontFamily: "var(--serif)",
            fontSize: 15,
            fontStyle: "italic",
            color: "var(--ink-4)",
            textAlign: "center",
            padding: "24px 0",
          }}
        >
          No output to score.
        </div>
      </div>
    );
  }

  return (
    <div className="pg-scorecard">
      <div className="pg-scorecard-hd">
        <div>
          <div className="nm">{blindLabel ?? agentRun.modelName}</div>
          <div style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--ink-4)", marginTop: 2 }}>
            {blindLabel ? "model hidden" : agentRun.modelId}
          </div>
        </div>
        <div className="overall">
          {displayOverall}
          <span className="of">/100</span>
        </div>
      </div>

      <div className="pg-rubric">
        {RUBRIC_LABELS.map((row) => {
          const current = local[row.key];
          return (
            <div key={row.key} className="pg-rubric-row">
              <span className="lab">{row.label}</span>
              <StarRow
                value={current}
                onChange={(v) => update({ [row.key]: v } as Partial<ScorecardValue>)}
                {...(readOnly ? { disabled: true } : {})}
              />
              <span className="v">{current}</span>
            </div>
          );
        })}
      </div>

      <div className="pg-overall-row">
        <input
          type="range"
          min={0}
          max={100}
          value={displayOverall}
          onChange={(e) => update({ overall: Number(e.target.value) }, true)}
          disabled={readOnly}
          style={{ ["--pct" as unknown as string]: `${displayOverall}%` } as React.CSSProperties}
        />
        <span className="v">{displayOverall}</span>
      </div>

      <textarea
        className="pg-rationale"
        placeholder="rationale (optional) — what tipped your score?"
        value={local.rationale}
        onChange={(e) => update({ rationale: e.target.value })}
        disabled={readOnly}
        rows={3}
      />
    </div>
  );
}

function StarRow({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="pg-stars" role="radiogroup">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          className={"pg-star" + (n <= value ? " on" : "")}
          onClick={() => !disabled && onChange(n)}
          disabled={disabled}
          aria-label={`${n} of 5`}
          style={{ background: "transparent", border: "none", padding: 0 }}
        >
          <svg
            viewBox="0 0 14 14"
            width="14"
            height="14"
            fill={n <= value ? "currentColor" : "none"}
            stroke="currentColor"
            strokeWidth="1.4"
            aria-hidden="true"
          >
            <path d="M7 1.5l1.7 3.6 3.8.5-2.8 2.7.7 3.9L7 10.4l-3.4 1.8.7-3.9L1.5 5.6l3.8-.5z" />
          </svg>
        </button>
      ))}
    </div>
  );
}
