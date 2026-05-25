"use client";

import { useMemo } from "react";
import type {
  PlaygroundAgentRunResponse,
  PlaygroundEventResponse,
} from "../../lib/api";
import { pgVendor } from "../../lib/playground-vendor";

type ActivityRailProps = {
  agentRuns: PlaygroundAgentRunResponse[];
  events: PlaygroundEventResponse[];
  maxWallClockSeconds: number;
  sessionStartedAt: number | null;
  now: number;
};

type Block = { kind: "think" | "tool" | "err" | "idle"; a: number; b: number };

type RailLane = {
  id: string;
  modelId: string;
  modelName: string;
  blocks: Block[];
  cursor: number | null;
  elapsedLabel: string;
  finished: boolean;
};

export function ActivityRail({
  agentRuns,
  events,
  maxWallClockSeconds,
  sessionStartedAt,
  now,
}: ActivityRailProps) {
  const cap = Math.max(maxWallClockSeconds, 1) * 1000;

  const lanes: RailLane[] = useMemo(() => {
    const start = sessionStartedAt ?? earliestEventTime(events) ?? now;
    return agentRuns.map((run) => {
      const runEvents = events.filter((e) => e.agentRunId === run.id);
      const blocks = buildBlocks(runEvents, start, cap);
      const finished = run.status === "succeeded" || run.status === "failed";
      const cursorMs = finished ? null : Math.min(now - start, cap);
      const cursor = cursorMs == null ? null : (cursorMs / cap) * 100;
      return {
        id: run.id,
        modelId: run.modelId,
        modelName: run.modelName,
        blocks,
        cursor,
        elapsedLabel: formatElapsed(start, run, now),
        finished,
      };
    });
  }, [agentRuns, events, sessionStartedAt, now, cap]);

  const elapsedLabel = formatElapsed(
    sessionStartedAt ?? earliestEventTime(events) ?? now,
    null,
    now,
  );
  const capLabel = formatMmSs(cap);

  return (
    <div className="pg-rail">
      <div className="pg-rail-hd">
        <div className="ti">Activity · all agents</div>
        <div className="ts">
          elapsed{" "}
          <b style={{ color: "var(--ink-2)", fontWeight: 500 }}>{elapsedLabel}</b> /{" "}
          {capLabel} cap
        </div>
      </div>

      {lanes.map((lane) => (
        <div key={lane.id} className="pg-rail-lane">
          <div className="pg-rail-name">
            <span className="dot" style={{ background: pgVendor(lane.modelId) }} />
            <span className="ti">{lane.modelName}</span>
          </div>
          <div className="pg-rail-blocks">
            {lane.blocks.map((b, i) => (
              <span
                key={i}
                className={"pg-rail-blk " + b.kind}
                style={{
                  left: `${b.a}%`,
                  width: `${Math.max(b.b - b.a, 0.5)}%`,
                }}
              />
            ))}
            {lane.cursor != null && (
              <span className="pg-rail-cursor" style={{ left: `${lane.cursor}%` }} />
            )}
          </div>
          <div className="pg-rail-elapsed">{lane.elapsedLabel}</div>
        </div>
      ))}

      <div
        style={{
          marginTop: 8,
          display: "flex",
          gap: 14,
          fontFamily: "var(--mono)",
          fontSize: 10,
          color: "var(--ink-4)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
        }}
      >
        <LegendChip color="var(--ink-5)" label="thinking" />
        <LegendChip color="var(--accent)" label="tool call" />
        <LegendChip color="var(--err)" label="error" />
        <LegendChip color="var(--rule-2)" label="idle" />
      </div>
    </div>
  );
}

function LegendChip({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", gap: 5, alignItems: "center" }}>
      <span
        style={{
          width: 10,
          height: 6,
          borderRadius: 1,
          background: color,
        }}
      />
      {label}
    </span>
  );
}

function buildBlocks(
  events: PlaygroundEventResponse[],
  start: number,
  capMs: number,
): Block[] {
  if (events.length === 0) return [];
  const blocks: Block[] = [];
  const TOOL_KINDS = new Set(["tool_call_started", "tool_call_delta", "tool_call_finished"]);
  const ERR_KINDS = new Set(["error"]);
  // Walk events; for each event compute its pct position and emit a 1.5%-wide block
  // of the right kind. We merge adjacent same-kind blocks into one.
  let last: Block | null = null;
  for (const ev of events) {
    const t = new Date(ev.timestamp).getTime();
    if (!Number.isFinite(t)) continue;
    const pct = Math.min(Math.max((t - start) / capMs, 0), 1) * 100;
    const kind: Block["kind"] = ERR_KINDS.has(ev.kind)
      ? "err"
      : TOOL_KINDS.has(ev.kind)
        ? "tool"
        : ev.kind === "assistant_text_delta"
          ? "think"
          : "idle";
    const a = pct;
    const b = Math.min(pct + 1.5, 100);
    if (last && last.kind === kind && last.b >= a - 0.5) {
      last.b = Math.max(last.b, b);
    } else {
      const block: Block = { kind, a, b };
      blocks.push(block);
      last = block;
    }
  }
  return blocks;
}

function earliestEventTime(events: PlaygroundEventResponse[]): number | null {
  let min = Infinity;
  for (const ev of events) {
    const t = new Date(ev.timestamp).getTime();
    if (Number.isFinite(t) && t < min) min = t;
  }
  return Number.isFinite(min) ? min : null;
}

function formatElapsed(
  start: number,
  run: PlaygroundAgentRunResponse | null,
  now: number,
): string {
  const end = run?.finishedAt ? new Date(run.finishedAt).getTime() : now;
  const ms = Math.max(0, end - start);
  return formatMmSs(ms);
}

function formatMmSs(ms: number): string {
  const total = Math.floor(ms / 1000);
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return `${mm}:${String(ss).padStart(2, "0")}`;
}
