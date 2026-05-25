"use client";

import { useState } from "react";
import { StatusPill } from "../ui";
import { AttemptHistoryList } from "./AttemptHistoryList";
import type { CaseBuildActions, CaseBuildSnapshot, WorkflowNodeId } from "./types";

type Props = {
  state: CaseBuildSnapshot & CaseBuildActions;
};

export function NodeDetailPanel({ state }: Props) {
  const activeId = state.workflow.activeNodeId;
  const node = state.workflow.nodes.find((n) => n.id === activeId);
  if (!node) return null;
  return (
    <aside className="wf-detail-panel" aria-label="Step detail">
      <header className="wf-detail-head">
        <span className={`wf-detail-status wf-detail-status-${node.status}`}>{node.status}</span>
        <h2 className="wf-detail-title">{node.label}</h2>
        {node.attemptBadge ? (
          <span className="wf-attempt-badge wf-attempt-badge-lg">
            attempt {node.attemptBadge.current} of {node.attemptBadge.total}
          </span>
        ) : null}
      </header>
      {node.currentStage ? (
        <div className="wf-detail-stage">
          <code>{node.currentStage.tag}</code> · {node.currentStage.message}
        </div>
      ) : null}
      {node.errorMessage ? <div className="wf-detail-error">{node.errorMessage}</div> : null}
      <div className="wf-detail-body">{renderBody(activeId, state)}</div>
    </aside>
  );
}

function renderBody(id: WorkflowNodeId, state: Props["state"]) {
  switch (id) {
    case "import":
      return <ImportBody state={state} />;
    case "buildTests":
      return <BuildTestsBody state={state} />;
    case "validate":
      return <ValidateBody state={state} />;
    case "evaluatorLock":
      return <EvaluatorLockBody />;
    case "freeze":
      return <FreezeBody state={state} />;
  }
}

function ImportBody({ state }: Props) {
  const [issueUrl, setIssueUrl] = useState("");
  const [prUrl, setPrUrl] = useState("");
  if (state.importResult) {
    const issue = state.importResult.issue;
    return (
      <div className="wf-detail-stack">
        <div className="wf-kv">
          <div>
            <dt>Issue</dt>
            <dd>
              <a href={issue.url} target="_blank" rel="noreferrer">
                {issue.repoOwner}/{issue.repoName}#{String(issue.issueNumber)}
              </a>
            </dd>
          </div>
          <div>
            <dt>Title</dt>
            <dd>{issue.title}</dd>
          </div>
          <div>
            <dt>State</dt>
            <dd>{issue.state}</dd>
          </div>
        </div>
        {state.importResult.prCandidates.length > 0 ? (
          <>
            <h3 className="wf-detail-subhead">PR candidates ({state.importResult.prCandidates.length})</h3>
            <ul className="wf-pr-list">
              {state.importResult.prCandidates.map((pr) => (
                <li key={String(pr.pullNumber) + pr.url}>
                  <a href={pr.url} target="_blank" rel="noreferrer">
                    {pr.repository.owner}/{pr.repository.repo}#{String(pr.pullNumber)}
                  </a>{" "}
                  · {pr.title}
                  {!state.selectedPrResult ? (
                    <button
                      type="button"
                      className="btn2 wf-pr-btn"
                      disabled={state.isSelectingPr}
                      onClick={() => void state.selectPr(pr.url)}
                    >
                      Use this PR
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          </>
        ) : null}
        {!state.selectedPrResult ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void state.selectPr(prUrl);
            }}
            className="wf-form"
          >
            <label htmlFor="wf-pr-input">PR URL or number</label>
            <input
              id="wf-pr-input"
              value={prUrl}
              onChange={(e) => setPrUrl(e.target.value)}
              placeholder="https://github.com/owner/repo/pull/123 or 123"
            />
            <button type="submit" className="btn2 primary" disabled={state.isSelectingPr}>
              {state.isSelectingPr ? "Selecting…" : "Select PR"}
            </button>
            <p className="wf-form-help">
              You can paste the full URL (including the <code>/files</code> or <code>/changes</code> tab) — the wizard will normalize it.
            </p>
          </form>
        ) : null}
      </div>
    );
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void state.importIssue(issueUrl);
      }}
      className="wf-form"
    >
      <label htmlFor="wf-issue-url">GitHub issue URL</label>
      <input
        id="wf-issue-url"
        value={issueUrl}
        onChange={(e) => setIssueUrl(e.target.value)}
        placeholder="https://github.com/owner/repo/issues/123"
        required
      />
      <button type="submit" className="btn2 primary" disabled={state.isSubmittingImport}>
        {state.isSubmittingImport ? "Importing…" : "Import issue"}
      </button>
      <p className="wf-form-help">The wizard sends only the issue URL to the import endpoint.</p>
    </form>
  );
}

function BuildTestsBody({ state }: Props) {
  const job = state.caseBuilderJob;
  if (!job) {
    return <p className="wf-detail-empty">Waiting for the case-builder to receive a PR selection.</p>;
  }
  return (
    <div className="wf-detail-stack">
      <div className="wf-kv">
        <div>
          <dt>Queue</dt>
          <dd><code>{job.queueName}</code></dd>
        </div>
        <div>
          <dt>Job state</dt>
          <dd><StatusPill status={job.state} /></dd>
        </div>
        <div>
          <dt>Tries</dt>
          <dd>{job.attemptsMade}</dd>
        </div>
        <div>
          <dt>Processed</dt>
          <dd>{job.processedAt ?? "—"}</dd>
        </div>
      </div>
      {job.failedReason ? <div className="wf-detail-error">{job.failedReason}</div> : null}
      {state.selectedPrResult?.sweBenchStyleEntry ? (
        <>
          <h3 className="wf-detail-subhead">SWE-bench entry</h3>
          <div className="wf-kv">
            <div><dt>Instance</dt><dd><code>{state.selectedPrResult.sweBenchStyleEntry.instanceId}</code></dd></div>
            <div><dt>Repo</dt><dd>{state.selectedPrResult.sweBenchStyleEntry.repo}</dd></div>
            <div><dt>Base commit</dt><dd><code>{state.selectedPrResult.sweBenchStyleEntry.baseCommit.slice(0, 12)}</code></dd></div>
            <div><dt>Gold commit</dt><dd><code>{state.selectedPrResult.sweBenchStyleEntry.goldCommit.slice(0, 12)}</code></dd></div>
          </div>
        </>
      ) : null}
    </div>
  );
}

function ValidateBody({ state }: Props) {
  const job = state.validationRunnerJob;
  const detail = state.caseVersionDetail;
  const attempts = detail?.validationAttempts ?? [];
  return (
    <div className="wf-detail-stack">
      <div className="wf-kv">
        <div>
          <dt>Queue</dt>
          <dd><code>{job?.queueName ?? "pilab.validation-runner"}</code></dd>
        </div>
        <div>
          <dt>Job state</dt>
          <dd><StatusPill status={job?.state ?? "—"} /></dd>
        </div>
        <div>
          <dt>Strategy</dt>
          <dd>{detail?.evaluatorStrategy ? <code>{detail.evaluatorStrategy}</code> : "—"}</dd>
        </div>
      </div>
      {job?.failedReason ? <div className="wf-detail-error">{job.failedReason}</div> : null}
      <h3 className="wf-detail-subhead">Attempt history</h3>
      <AttemptHistoryList attempts={attempts} />
    </div>
  );
}

function EvaluatorLockBody() {
  return (
    <div className="wf-detail-stack">
      <p>
        Deterministic test generation exhausted its 3 attempts. At benchmark time, a Pi-evaluator
        agent will score each agent's solution against the gold patch instead of running unit tests.
      </p>
    </div>
  );
}

function FreezeBody({ state }: Props) {
  if (state.frozenCase) {
    return (
      <div className="wf-detail-stack">
        <p>Case is frozen and ready to be added to a dataset.</p>
        <p className="wf-detail-meta">Frozen at {state.frozenCase.frozenAt ?? "—"}</p>
      </div>
    );
  }
  if (state.rejectedCase) {
    return (
      <div className="wf-detail-stack">
        <p>Case was rejected and will not be used.</p>
      </div>
    );
  }
  const canAct = Boolean(state.selectedPrResult);
  return (
    <div className="wf-detail-stack">
      <p>Freeze the case to make it available to experiments, or reject it to discard.</p>
      <div className="wf-detail-actions">
        <button type="button" className="btn2 primary" disabled={!canAct || state.isFreezing} onClick={() => void state.freeze()}>
          {state.isFreezing ? "Freezing…" : "Freeze case"}
        </button>
        <button type="button" className="btn2" disabled={!canAct || state.isRejecting} onClick={() => void state.reject()}>
          {state.isRejecting ? "Rejecting…" : "Reject"}
        </button>
      </div>
      {state.errors.caseAction ? <div className="wf-detail-error">{state.errors.caseAction}</div> : null}
    </div>
  );
}
