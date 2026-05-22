"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type {
  ModelInfo,
  PlaygroundAgentRunResponse,
  PlaygroundAutograderRunResponse,
  PlaygroundScoreInput,
  PlaygroundSessionResponse,
} from "../../lib/api";
import { ComparisonTile } from "./ComparisonTile";
import { Scorecard, type ScorecardValue } from "./Scorecard";
import { AutogradePanel } from "./AutogradePanel";
import { StepRail } from "./StepRail";

type ScoreStepProps = {
  session: PlaygroundSessionResponse;
  models: ModelInfo[];
  autograders: PlaygroundAutograderRunResponse[];
  blind: boolean;
  onBlindChange: (next: boolean) => void;
  onSubmit: (scores: PlaygroundScoreInput[]) => Promise<void>;
  onAutoGrade: (graderIds: string[]) => Promise<void>;
  isGrading: boolean;
};

const LETTERS = ["A", "B", "C", "D", "E"];

export function ScoreStep({
  session,
  models,
  autograders,
  blind,
  onBlindChange,
  onSubmit,
  onAutoGrade,
  isGrading,
}: ScoreStepProps) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, ScorecardValue>>({});
  const [primaryGrader, setPrimaryGrader] = useState(
    session.graderModelId ?? "anthropic/claude-haiku-4",
  );
  const [submitting, setSubmitting] = useState(false);
  const [submitNotice, setSubmitNotice] = useState<string | null>(null);
  const [showAutograder, setShowAutograder] = useState(autograders.length > 0);

  useEffect(() => {
    if (autograders.length > 0) setShowAutograder(true);
  }, [autograders.length]);

  const scorableRuns = useMemo(
    () => session.agentRuns.filter((r) => r.status === "succeeded" && r.output),
    [session.agentRuns],
  );

  const alreadyScored = session.agentRuns.some((r) => r.score !== null);

  async function handleSubmit() {
    setSubmitting(true);
    setSubmitNotice(null);
    try {
      const payload: PlaygroundScoreInput[] = scorableRuns.map((r) => {
        const v = values[r.id];
        return {
          agentRunId: r.id,
          score: v?.overall ?? r.score ?? 50,
          ...(v?.rationale ? { rationale: v.rationale } : {}),
          correctness: v?.correctness ?? r.scoreCorrectness ?? null,
          codeQuality: v?.codeQuality ?? r.scoreCodeQuality ?? null,
          ux: v?.ux ?? r.scoreUx ?? null,
          shipIt: v?.shipIt ?? r.scoreShipIt ?? null,
        };
      });
      await onSubmit(payload);
      setSubmitNotice("Scores saved — opening the saved-session view…");
      // Drop into the read-only saved view; it shows the persisted scores +
      // an autograde panel + the share/tag controls.
      router.push(`/playground/${session.id}`);
    } catch (err) {
      setSubmitNotice(
        err instanceof Error ? `Couldn't save scores: ${err.message}` : "Couldn't save scores.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleQuickAutograde() {
    setShowAutograder(true);
    await onAutoGrade([primaryGrader]);
  }

  async function handleMultiAutograde(graderIds: string[]) {
    setShowAutograder(true);
    await onAutoGrade(graderIds);
  }

  return (
    <div className="pg-page">
      <StepRail current="score" sessionId={session.id} />

      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 14 }}>
        <BlindToggle blind={blind} onChange={onBlindChange} />
      </div>

      <SectionCaption num="1" label="what they built" />
      <div className="pg-tiles">
        {session.agentRuns.map((run, idx) => (
          <ComparisonTile
            key={run.id}
            agentRun={run}
            blindLabel={blind ? `Agent ${LETTERS[idx] ?? idx + 1}` : null}
          />
        ))}
      </div>

      <SectionCaption num="2" label="rate by rubric" />
      <div className="pg-scoregrid">
        {session.agentRuns.map((run, idx) => (
          <Scorecard
            key={run.id}
            agentRun={run}
            blindLabel={blind ? `Agent ${LETTERS[idx] ?? idx + 1}` : null}
            onChange={(v) => setValues((prev) => ({ ...prev, [run.id]: v }))}
            readOnly={alreadyScored && !values[run.id]}
          />
        ))}
      </div>

      {showAutograder && (
        <AutogradePanel
          prompt={session.prompt}
          agentRuns={session.agentRuns}
          autograders={autograders}
          primaryGraderId={primaryGrader}
          onChangePrimary={setPrimaryGrader}
          models={models}
          onGrade={(ids) => void handleMultiAutograde(ids)}
          isGrading={isGrading}
        />
      )}

      <div className="pg-score-actions">
        <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-3)" }}>
          <b style={{ color: "var(--ink)", fontWeight: 500 }}>
            {scorableRuns.length}
          </b>{" "}
          of {session.agentRuns.length} eligible · {session.agentRuns.length - scorableRuns.length} skipped
          {submitNotice && (
            <span
              style={{
                marginLeft: 10,
                color: submitNotice.startsWith("Couldn") ? "var(--err)" : "var(--ok)",
              }}
            >
              · {submitNotice}
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {!showAutograder && (
            <button
              type="button"
              className="btn2"
              disabled={isGrading || scorableRuns.length === 0}
              onClick={() => void handleQuickAutograde()}
            >
              {isGrading ? "Grading…" : "Auto-grade with AI"}
            </button>
          )}
          <button
            type="button"
            className="btn2 primary"
            disabled={submitting || scorableRuns.length === 0}
            onClick={() => void handleSubmit()}
          >
            {submitting ? "Saving…" : "Submit scores →"}
          </button>
        </div>
      </div>
    </div>
  );
}

function SectionCaption({ num, label }: { num: string; label: string }) {
  return (
    <div
      style={{
        fontFamily: "var(--mono)",
        fontSize: 10.5,
        color: "var(--ink-4)",
        textTransform: "uppercase",
        letterSpacing: "0.07em",
        marginTop: 8,
        marginBottom: 10,
      }}
    >
      {num} · {label}
    </div>
  );
}

function BlindToggle({ blind, onChange }: { blind: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!blind)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 12px",
        border: "1px solid var(--rule-2)",
        borderRadius: 999,
        fontFamily: "var(--mono)",
        fontSize: 11,
        color: blind ? "var(--ink)" : "var(--ink-3)",
        background: blind ? "var(--paper-3)" : "var(--paper)",
        cursor: "pointer",
      }}
      aria-pressed={blind}
    >
      <span
        style={{
          width: 18,
          height: 10,
          borderRadius: 999,
          background: blind ? "var(--ink)" : "var(--rule-3)",
          position: "relative",
          transition: "background 180ms ease",
        }}
      >
        <span
          style={{
            position: "absolute",
            top: 1,
            left: blind ? 9 : 1,
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: "var(--paper)",
            transition: "left 200ms ease",
          }}
        />
      </span>
      Blind scoring
      {blind && (
        <span
          style={{
            fontFamily: "var(--mono)",
            fontSize: 9,
            padding: "1px 5px",
            background: "var(--ink)",
            color: "var(--paper)",
            borderRadius: 3,
            letterSpacing: "0.04em",
          }}
        >
          ON
        </span>
      )}
    </button>
  );
}
