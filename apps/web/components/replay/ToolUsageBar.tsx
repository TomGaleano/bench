"use client";

import { useMemo } from "react";
import type { DurableRunEvent } from "../../lib/api";

type ToolUsageBarProps = {
  events: DurableRunEvent[];
};

function pickTool(event: DurableRunEvent): string | null {
  const payload = event.payload as Record<string, unknown> | null;
  if (payload && typeof payload.toolName === "string") return payload.toolName;
  if (payload && typeof payload.tool === "string") return payload.tool;
  return null;
}

export function ToolUsageBar({ events }: ToolUsageBarProps) {
  const tools = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of events) {
      if (e.kind !== "tool_call_started") continue;
      const name = pickTool(e);
      if (!name) continue;
      map.set(name, (map.get(name) ?? 0) + 1);
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [events]);

  if (tools.length === 0) {
    return (
      <div className="tool-usage empty">
        <span className="lab">Tool usage</span>
        <p>No tool calls recorded.</p>
      </div>
    );
  }

  const max = Math.max(...tools.map(([, n]) => n));

  return (
    <div className="tool-usage">
      <span className="lab">Tool usage</span>
      <ul>
        {tools.map(([name, count]) => (
          <li key={name}>
            <span className="ti">{name}</span>
            <span className="track">
              <i style={{ width: `${(count / max) * 100}%` }} />
            </span>
            <span className="ct">{count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
