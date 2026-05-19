"use client";

import { useMemo } from "react";
import type { DurableRunEvent } from "../../lib/api";

const KIND_COLORS: Record<string, string> = {
  assistant_text_delta: "var(--cool)",
  tool_call_started: "var(--accent)",
  tool_call_finished: "var(--accent)",
  tool_call_delta: "var(--accent)",
  file_changed: "var(--plum)",
  patch_created: "var(--plum)",
  test_started: "var(--warn)",
  test_finished: "var(--ok)",
  status: "var(--ink-4)",
  judge_decision: "var(--ink)",
};

function colorFor(kind: string) {
  return KIND_COLORS[kind] ?? "var(--ink-3)";
}

type EventTimelineProps = {
  events: DurableRunEvent[];
  focusId: string | null;
  onFocus: (id: string) => void;
};

export function EventTimeline({ events, focusId, onFocus }: EventTimelineProps) {
  const layout = useMemo(() => {
    if (events.length === 0) return null;
    const first = new Date(events[0]?.timestamp ?? Date.now()).getTime();
    const last = new Date(events[events.length - 1]?.timestamp ?? Date.now()).getTime();
    const span = Math.max(1, last - first);
    return {
      first,
      span,
      ticks: Array.from({ length: 6 }, (_, i) => first + (span * i) / 5),
    };
  }, [events]);

  if (!events.length || !layout) {
    return (
      <div className="ev-timeline empty">
        <strong>No events yet</strong>
        <p>Run events will stream into this timeline as the agent works.</p>
      </div>
    );
  }

  return (
    <div className="ev-timeline">
      <div className="ev-axis">
        {layout.ticks.map((t, i) => {
          const pct = ((t - layout.first) / layout.span) * 100;
          const date = new Date(t);
          return (
            <span key={i} className="ev-tick" style={{ left: `${pct}%` }}>
              <i />
              <time>{date.toLocaleTimeString([], { minute: "2-digit", second: "2-digit" })}</time>
            </span>
          );
        })}
      </div>
      <div className="ev-track">
        {events.map((event, i) => {
          const ts = new Date(event.timestamp).getTime();
          const pct = ((ts - layout.first) / layout.span) * 100;
          const isFocused = focusId === event.id;
          const above = i % 2 === 0;
          return (
            <button
              key={event.id}
              aria-label={`Event ${event.seq}: ${event.kind}`}
              className={"ev-node" + (isFocused ? " focused" : "") + (above ? " above" : " below")}
              onClick={() => onFocus(event.id)}
              style={{ left: `${pct}%`, color: colorFor(event.kind) }}
              type="button"
            >
              <span className="dot" />
              <span className="label">
                <em>{event.stage}</em>
                <small>{event.kind.replace(/_/g, " ")}</small>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
