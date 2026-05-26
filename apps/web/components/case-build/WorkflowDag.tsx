"use client";

import { useLayoutEffect, useRef, useState } from "react";
import type { WorkflowEdge as WorkflowEdgeData, WorkflowNode as WorkflowNodeData, WorkflowNodeId, WorkflowState } from "./types";
import { WorkflowNode } from "./WorkflowNode";
import { WorkflowArrowDefs, WorkflowEdge } from "./WorkflowEdge";

type Props = {
  state: WorkflowState;
  onSelectNode(id: WorkflowNodeId): void;
};

type NodeBox = { id: WorkflowNodeId; left: number; top: number; width: number; height: number };

export function WorkflowDag({ state, onSelectNode }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef(new Map<WorkflowNodeId, HTMLButtonElement>());
  const [boxes, setBoxes] = useState<NodeBox[]>([]);
  const [svgSize, setSvgSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });

  // Measure node positions after each render so the SVG edges follow them.
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const containerRect = container.getBoundingClientRect();
    const next: NodeBox[] = [];
    for (const node of state.nodes) {
      const el = nodeRefs.current.get(node.id);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      next.push({
        id: node.id,
        left: r.left - containerRect.left,
        top: r.top - containerRect.top,
        width: r.width,
        height: r.height,
      });
    }
    setBoxes(next);
    setSvgSize({ width: container.clientWidth, height: container.clientHeight });
  }, [state]);

  const nodeStatus = (id: WorkflowNodeId) =>
    state.nodes.find((n) => n.id === id)?.status ?? "pending";

  return (
    <div className="wf-dag" ref={containerRef}>
      <svg className="wf-dag-svg" width={svgSize.width} height={svgSize.height} aria-hidden>
        <WorkflowArrowDefs />
        {state.edges.map((edge: WorkflowEdgeData) => {
          const from = boxes.find((b) => b.id === edge.from);
          const to = boxes.find((b) => b.id === edge.to);
          if (!from || !to) return null;
          // Connect right-middle of `from` to left-middle of `to`.
          const x1 = from.left + from.width;
          const y1 = from.top + from.height / 2;
          const x2 = to.left;
          const y2 = to.top + to.height / 2;
          return (
            <WorkflowEdge
              key={`${edge.from}-${edge.to}`}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              fromStatus={nodeStatus(edge.from)}
              toStatus={nodeStatus(edge.to)}
            />
          );
        })}
      </svg>
      <div className="wf-dag-row">
        {state.nodes.map((node: WorkflowNodeData) => (
          <NodeSlot
            key={node.id}
            node={node}
            isActive={state.activeNodeId === node.id}
            onClick={() => onSelectNode(node.id)}
            assignRef={(el) => {
              if (el) nodeRefs.current.set(node.id, el);
              else nodeRefs.current.delete(node.id);
            }}
          />
        ))}
      </div>
    </div>
  );
}

function NodeSlot({
  node,
  isActive,
  onClick,
  assignRef,
}: {
  node: WorkflowNodeData;
  isActive: boolean;
  onClick: () => void;
  assignRef(el: HTMLButtonElement | null): void;
}) {
  return (
    <div className="wf-dag-slot">
      <WorkflowNodeRef node={node} isActive={isActive} onClick={onClick} assignRef={assignRef} />
    </div>
  );
}

function WorkflowNodeRef({
  node,
  isActive,
  onClick,
  assignRef,
}: {
  node: WorkflowNodeData;
  isActive: boolean;
  onClick: () => void;
  assignRef(el: HTMLButtonElement | null): void;
}) {
  // Inline thin wrapper that grants access to the underlying DOM button for measurement.
  return (
    <span ref={(el) => assignRef(el ? (el.firstElementChild as HTMLButtonElement | null) : null)}>
      <WorkflowNode node={node} isActive={isActive} onClick={onClick} />
    </span>
  );
}
