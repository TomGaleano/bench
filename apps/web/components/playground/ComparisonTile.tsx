"use client";

import type { PlaygroundAgentRunResponse } from "../../lib/api";
import { pgVendor } from "../../lib/playground-vendor";
import { PreviewTile } from "./PreviewTile";

type ComparisonTileProps = {
  agentRun: PlaygroundAgentRunResponse;
  blindLabel: string | null;
};

export function ComparisonTile({ agentRun, blindLabel }: ComparisonTileProps) {
  const failed = agentRun.status === "failed";
  const displayName = blindLabel ?? agentRun.modelName;
  const elapsedLabel = elapsed(agentRun.startedAt, agentRun.finishedAt);
  const finalLine = extractFinal(agentRun.output);

  return (
    <div className={"pg-tile" + (failed ? " failed" : "")}>
      <div className="pg-tile-hd">
        <span className="pg-vendor-dot" style={{ background: pgVendor(agentRun.modelId) }} />
        <span className="nm">{displayName}</span>
        <span className={"badge " + (failed ? "err" : "ok")}>
          {failed ? "FAIL" : `OK · ${elapsedLabel ?? "—"}`}
        </span>
      </div>
      {failed ? (
        <div className="pg-preview">
          <span className="msg">No output to score.</span>
        </div>
      ) : (
        <PreviewTile
          url={agentRun.appUrl}
          status={agentRun.appUrl ? "ok" : "pending"}
          {...(agentRun.appUrl ? {} : { message: "Agent didn't bind a port — read the transcript above." })}
        />
      )}
      <div className="pg-tile-stats">
        <div className="cell">
          <span className="lab">Files</span>
          <span className="v">{agentRun.fileCount ?? "—"}</span>
        </div>
        <div className="cell">
          <span className="lab">LOC</span>
          <span className="v">{agentRun.loc ?? "—"}</span>
        </div>
        <div className="cell">
          <span className="lab">Wall</span>
          <span className="v">{elapsedLabel ?? "—"}</span>
        </div>
      </div>
      {finalLine && (
        <div className="pg-tile-final">
          <span className="lab">Final message</span>
          {finalLine}
        </div>
      )}
    </div>
  );
}

function elapsed(start: string | null, end: string | null): string | null {
  if (!start || !end) return null;
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function extractFinal(output: string | null): string | null {
  if (!output) return null;
  // Grab from the last "FINAL:" prefix to the end (the system prompt asks
  // the agent to begin its final message with "FINAL:").
  const idx = output.lastIndexOf("FINAL:");
  if (idx < 0) return null;
  const tail = output.slice(idx + 6).trim();
  if (tail.length === 0) return null;
  return tail.length > 240 ? tail.slice(0, 239) + "…" : tail;
}
