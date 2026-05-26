"use client";

import { Hero } from "../../../components/ui/Hero";
import { NodeDetailPanel } from "../../../components/case-build/NodeDetailPanel";
import { WorkflowDag } from "../../../components/case-build/WorkflowDag";
import { useCaseBuildState } from "../../../components/case-build/useCaseBuildState";

export default function NewCasePage() {
  const state = useCaseBuildState();
  const workersMissing = state.workersStatus
    ? !state.workersStatus.caseBuilder.hasWorkers || !state.workersStatus.validationRunner.hasWorkers
    : false;
  const activeNode = state.workflow.nodes.find((n) => n.id === state.workflow.activeNodeId);
  const lede = lede_for(state, activeNode?.label ?? "Ready");

  return (
    <div className="mdl-page wf-page">
      <Hero
        eyebrow="New case · workflow"
        live={state.workflow.nodes.some((n) => n.status === "running")}
        title={
          <>
            Build a <em>SWE-bench-style</em> case from a GitHub issue.
          </>
        }
        lede={lede}
        meta={[
          ["Active step", activeNode?.label ?? "—"],
          [
            "Strategy",
            state.caseVersionDetail?.evaluatorStrategy ?? "tbd",
          ],
        ]}
      />

      {workersMissing ? (
        <div className="wf-warning-banner">
          <strong>Workers missing.</strong> One or more case-builder / validation-runner workers
          aren't ready. Start the dev stack with <code>pnpm dev</code>.
        </div>
      ) : null}

      <div className="wf-layout">
        <WorkflowDag state={state.workflow} onSelectNode={state.setActiveNode} />
        <NodeDetailPanel state={state} />
      </div>
    </div>
  );
}

function lede_for(state: ReturnType<typeof useCaseBuildState>, activeLabel: string): string {
  if (state.frozenCase) return "Case frozen and ready to use in experiments.";
  if (state.rejectedCase) return "Case was rejected.";
  if (state.workflow.nodes.some((n) => n.status === "failed")) return `Something went wrong at ${activeLabel}.`;
  if (state.workflow.nodes.some((n) => n.status === "running")) return `Running ${activeLabel}…`;
  if (state.selectedPrResult || state.importResult) return `Working through ${activeLabel}.`;
  return "Import an issue to begin. Each step's details appear in the panel on the right.";
}
