"use client";

import type { CSSProperties } from "react";
import type { WorkflowNode as WorkflowNodeData } from "./types";

type Props = {
  node: WorkflowNodeData;
  isActive: boolean;
  onClick: () => void;
  style?: CSSProperties;
};

export function WorkflowNode({ node, isActive, onClick, style }: Props) {
  const stateClass = `wf-node-${node.status}`;
  const className = ["wf-node", stateClass, isActive ? "wf-node-active" : ""].filter(Boolean).join(" ");
  return (
    <button type="button" className={className} onClick={onClick} style={style} aria-pressed={isActive}>
      <span className="wf-node-icon" aria-hidden>
        {renderIcon(node.status)}
      </span>
      <span className="wf-node-body">
        <span className="wf-node-label">{node.label}</span>
        {node.attemptBadge ? (
          <span className="wf-attempt-badge" title="Test-generation attempt">
            {node.attemptBadge.current}/{node.attemptBadge.total}
          </span>
        ) : null}
        {node.currentStage ? (
          <span className="wf-node-stage">
            <code>{node.currentStage.tag}</code>{" "}
            <span className="wf-node-stage-msg">{node.currentStage.message}</span>
          </span>
        ) : null}
        {node.errorMessage ? <span className="wf-node-error">{node.errorMessage}</span> : null}
      </span>
    </button>
  );
}

function renderIcon(status: WorkflowNodeData["status"]) {
  switch (status) {
    case "done":
      return (
        <svg viewBox="0 0 16 16" width="14" height="14">
          <path d="M3 8 L7 12 L13 4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "failed":
      return <span style={{ fontWeight: 700 }}>!</span>;
    case "running":
      return <span className="wf-node-spinner" />;
    case "skipped":
      return <span style={{ opacity: 0.5 }}>—</span>;
    default:
      return <span className="wf-node-dot" />;
  }
}
