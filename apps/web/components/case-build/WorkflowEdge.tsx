"use client";

import type { NodeStatus } from "./types";

type Props = {
  /** Inclusive bounding box of the edge in the parent SVG. */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Status of the upstream node — drives the color. */
  fromStatus: NodeStatus;
  /** Status of the downstream node — when both upstream and downstream are done, the edge is solid green; otherwise dashed pending. */
  toStatus: NodeStatus;
};

export function WorkflowEdge({ x1, y1, x2, y2, fromStatus, toStatus }: Props) {
  const stateClass =
    fromStatus === "done" && (toStatus === "done" || toStatus === "running")
      ? "wf-edge-done"
      : fromStatus === "running"
        ? "wf-edge-running"
        : fromStatus === "failed"
          ? "wf-edge-failed"
          : "wf-edge-pending";
  // Smooth horizontal cubic bezier; offset midpoint so the curve hugs the node row.
  const midX = (x1 + x2) / 2;
  const path = `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;
  return (
    <g className={`wf-edge ${stateClass}`}>
      <path d={path} fill="none" strokeWidth={2} markerEnd="url(#wf-arrow)" />
    </g>
  );
}

export function WorkflowArrowDefs() {
  return (
    <defs>
      <marker
        id="wf-arrow"
        viewBox="0 0 10 10"
        refX="9"
        refY="5"
        markerWidth="6"
        markerHeight="6"
        orient="auto-start-reverse"
      >
        <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
      </marker>
    </defs>
  );
}
