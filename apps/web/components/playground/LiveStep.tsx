"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  PlaygroundAgentRunResponse,
  PlaygroundEventResponse,
  PlaygroundSessionResponse,
} from "../../lib/api";
import { ActivityRail } from "./ActivityRail";
import { AgentPanel } from "./AgentPanel";
import { StepRail } from "./StepRail";

export type LiveLayoutMode = "grid" | "focus" | "stack";

type LiveStepProps = {
  session: PlaygroundSessionResponse;
  events: PlaygroundEventResponse[];
  maxWallClockSeconds: number;
  allCompleted: boolean;
  allFailed: boolean;
  onContinue: () => void;
  onStopAgent?: (agentRunId: string) => void;
  onSendFollowUp?: (agentRunId: string, text: string) => Promise<void>;
  sandboxReleased?: boolean;
};

export function LiveStep({
  session,
  events,
  maxWallClockSeconds,
  allCompleted,
  allFailed,
  onContinue,
  onStopAgent,
  onSendFollowUp,
  sandboxReleased = false,
}: LiveStepProps) {
  const [mode, setMode] = useState<LiveLayoutMode>("grid");
  const [focusedAgentId, setFocusedAgentId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Tick clock for live elapsed labels and cursor.
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const sessionStartedAt = useMemo(() => {
    const startTimes = session.agentRuns
      .map((r) => (r.startedAt ? new Date(r.startedAt).getTime() : null))
      .filter((t): t is number => t != null && Number.isFinite(t));
    if (startTimes.length === 0) return null;
    return Math.min(...startTimes);
  }, [session.agentRuns]);

  const focusedRun: PlaygroundAgentRunResponse | null = useMemo(() => {
    if (mode !== "focus") return null;
    if (focusedAgentId) {
      return session.agentRuns.find((r) => r.id === focusedAgentId) ?? session.agentRuns[0] ?? null;
    }
    // Default focus: first running, then first succeeded, else first.
    const running = session.agentRuns.find((r) => r.status === "running" || r.status === "preparing");
    if (running) return running;
    const succeeded = session.agentRuns.find((r) => r.status === "succeeded");
    return succeeded ?? session.agentRuns[0] ?? null;
  }, [mode, focusedAgentId, session.agentRuns]);

  const completedCount = session.agentRuns.filter(
    (r) => r.status === "succeeded" || r.status === "failed",
  ).length;
  const totalCount = session.agentRuns.length;

  const gridCols = computeGridCols(totalCount);
  const stackCols = "1fr";

  return (
    <div className="pg-page">
      <StepRail current="live" sessionId={session.id} />

      <ActivityRail
        agentRuns={session.agentRuns}
        events={events}
        maxWallClockSeconds={maxWallClockSeconds}
        sessionStartedAt={sessionStartedAt}
        now={now}
      />

      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 14 }}>
        <LayoutToggle current={mode} onChange={setMode} />
      </div>

      {allFailed && (
        <div className="mdl-err" style={{ marginBottom: 16 }}>
          <h3>All agents failed</h3>
          <p>None of the agents produced a usable output. Review the transcripts below or start a new session.</p>
        </div>
      )}

      {mode === "focus" && focusedRun ? (
        <div className="pg-focused">
          <AgentPanel
            agentRun={focusedRun}
            events={events.filter((e) => e.agentRunId === focusedRun.id)}
            index={session.agentRuns.findIndex((r) => r.id === focusedRun.id)}
            showPreview={Boolean(focusedRun.appUrl)}
            sandboxReleased={sandboxReleased}
            {...(onStopAgent ? { onStop: () => onStopAgent(focusedRun.id) } : {})}
            {...(onSendFollowUp ? { onSendFollowUp: (text: string) => onSendFollowUp(focusedRun.id, text) } : {})}
          />
          <div className="pg-focused-strip">
            <div
              style={{
                fontFamily: "var(--mono)",
                fontSize: 10,
                color: "var(--ink-4)",
                textTransform: "uppercase",
                letterSpacing: "0.07em",
                padding: "4px 2px",
              }}
            >
              Other agents
            </div>
            {session.agentRuns
              .filter((r) => r.id !== focusedRun.id)
              .map((r) => (
                <FocusThumb
                  key={r.id}
                  agentRun={r}
                  onClick={() => setFocusedAgentId(r.id)}
                />
              ))}
          </div>
        </div>
      ) : (
        <div
          className="pg-agents"
          style={{ gridTemplateColumns: mode === "stack" ? stackCols : gridCols }}
        >
          {session.agentRuns.map((run, idx) => (
            <AgentPanel
              key={run.id}
              agentRun={run}
              events={events.filter((e) => e.agentRunId === run.id)}
              index={idx}
              sandboxReleased={sandboxReleased}
              {...(onStopAgent ? { onStop: () => onStopAgent(run.id) } : {})}
              {...(onSendFollowUp ? { onSendFollowUp: (text: string) => onSendFollowUp(run.id, text) } : {})}
            />
          ))}
        </div>
      )}

      <div className="pg-continue">
        <button
          type="button"
          className="btn2 primary"
          disabled={!allCompleted || allFailed}
          onClick={onContinue}
          style={!allCompleted || allFailed ? { opacity: 0.5, cursor: "not-allowed" } : undefined}
        >
          Continue to scoring →
          <span
            style={{
              fontFamily: "var(--mono)",
              fontSize: 10,
              color: allCompleted ? undefined : "var(--ink-4)",
              marginLeft: 8,
            }}
          >
            {completedCount} of {totalCount} agents complete
          </span>
        </button>
      </div>
    </div>
  );
}

function computeGridCols(n: number): string {
  if (n <= 1) return "1fr";
  if (n === 2) return "repeat(2, 1fr)";
  if (n === 3) return "repeat(3, 1fr)";
  // 4+ agents: 2 columns (matches the design's "Grid · 4 agents" artboard).
  return "repeat(2, 1fr)";
}

function LayoutToggle({
  current,
  onChange,
}: {
  current: LiveLayoutMode;
  onChange: (next: LiveLayoutMode) => void;
}) {
  const options: Array<{ k: LiveLayoutMode; l: string; ico: React.ReactNode }> = [
    {
      k: "grid",
      l: "Grid",
      ico: (
        <svg width="11" height="11" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
          <rect x="1" y="1" width="4" height="4" />
          <rect x="7" y="1" width="4" height="4" />
          <rect x="1" y="7" width="4" height="4" />
          <rect x="7" y="7" width="4" height="4" />
        </svg>
      ),
    },
    {
      k: "focus",
      l: "Focused",
      ico: (
        <svg width="11" height="11" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
          <rect x="1" y="1" width="7" height="10" />
          <rect x="9" y="1" width="2" height="2.5" />
          <rect x="9" y="4.5" width="2" height="2.5" />
          <rect x="9" y="8" width="2" height="3" />
        </svg>
      ),
    },
    {
      k: "stack",
      l: "Stack",
      ico: (
        <svg width="11" height="11" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
          <rect x="1" y="1" width="10" height="2" />
          <rect x="1" y="5" width="10" height="2" />
          <rect x="1" y="9" width="10" height="2" />
        </svg>
      ),
    },
  ];

  return (
    <div className="pg-layout-toggle">
      {options.map((o) => (
        <button
          key={o.k}
          type="button"
          className={current === o.k ? "on" : ""}
          onClick={() => onChange(o.k)}
          aria-pressed={current === o.k}
        >
          {o.ico}
          {o.l}
        </button>
      ))}
    </div>
  );
}

function FocusThumb({
  agentRun,
  onClick,
}: {
  agentRun: PlaygroundAgentRunResponse;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="pg-thumb"
      style={{ background: "var(--paper)", textAlign: "left", border: "1px solid var(--rule)" }}
    >
      <div className="row">
        <span className={"pg-status-dot " + agentRun.status} />
        <span className="nm">{agentRun.modelName}</span>
      </div>
      <div className="mini-tx">
        {agentRun.status === "succeeded"
          ? "done"
          : agentRun.status === "failed"
            ? "failed"
            : agentRun.status === "running"
              ? "running…"
              : agentRun.status}
        {agentRun.appUrl ? " · app ready" : ""}
      </div>
    </button>
  );
}
