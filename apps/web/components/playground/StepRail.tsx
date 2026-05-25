"use client";

import { Fragment } from "react";

export type PlaygroundStep = "compose" | "live" | "score";

const STEPS: Array<{ key: PlaygroundStep; numeral: string; label: string }> = [
  { key: "compose", numeral: "i", label: "Compose" },
  { key: "live", numeral: "ii", label: "Live" },
  { key: "score", numeral: "iii", label: "Score" },
];

type StepRailProps = {
  current: PlaygroundStep;
  sessionId?: string | null;
};

export function StepRail({ current, sessionId }: StepRailProps) {
  const currentIndex = STEPS.findIndex((s) => s.key === current);
  const sessionLabel = sessionId ? `pg_${sessionId.slice(0, 8)}` : "—";

  return (
    <div className="pg-steps">
      {STEPS.map((step, i) => (
        <Fragment key={step.key}>
          {i > 0 && <span className="pg-step-line" />}
          <span
            className={
              "pg-step " + (i < currentIndex ? "done" : i === currentIndex ? "cur" : "")
            }
          >
            <span className="n">{step.numeral}</span>
            {step.label}
          </span>
        </Fragment>
      ))}
      <span className="pg-spacer" />
      <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-4)" }}>
        session{" "}
        <b style={{ color: "var(--ink-2)", fontWeight: 500 }}>{sessionLabel}</b>
      </span>
    </div>
  );
}
