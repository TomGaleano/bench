"use client";

import type { ValidationAttemptSummary } from "../../lib/api";
import { StatusPill } from "../ui";

type Props = {
  attempts: ValidationAttemptSummary[];
};

export function AttemptHistoryList({ attempts }: Props) {
  if (attempts.length === 0) {
    return <p className="wf-detail-empty">No validation attempts yet.</p>;
  }
  const sorted = [...attempts].sort((a, b) => a.attemptNumber - b.attemptNumber);
  return (
    <ol className="wf-attempt-list">
      {sorted.map((attempt) => (
        <li key={attempt.id} className="wf-attempt-item">
          <div className="wf-attempt-head">
            <span className="wf-attempt-num">#{attempt.attemptNumber}</span>
            <StatusPill status={attempt.status} />
            <span className="wf-attempt-counts">
              <strong>{attempt.acceptedTestCount}</strong> accepted ·{" "}
              <strong>{attempt.rejectedTestCount}</strong> rejected
            </span>
          </div>
          <div className="wf-attempt-meta">
            <code>{attempt.runnerVersion}</code>
            {attempt.startedAt ? <span>started {formatTime(attempt.startedAt)}</span> : null}
            {attempt.finishedAt ? <span>finished {formatTime(attempt.finishedAt)}</span> : null}
          </div>
          <div className="wf-attempt-artifacts">
            {attempt.baseLogArtifactId ? (
              <span title={attempt.baseLogArtifactId}>
                base log: <code>{shortenId(attempt.baseLogArtifactId)}</code>
              </span>
            ) : null}
            {attempt.goldLogArtifactId ? (
              <span title={attempt.goldLogArtifactId}>
                gold log: <code>{shortenId(attempt.goldLogArtifactId)}</code>
              </span>
            ) : null}
            {attempt.candidateTestsArtifactId ? (
              <span title={attempt.candidateTestsArtifactId}>
                candidate tests: <code>{shortenId(attempt.candidateTestsArtifactId)}</code>
              </span>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

function shortenId(value: string | null): string {
  if (!value) return "—";
  return value.length > 12 ? `${value.slice(0, 8)}…` : value;
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return iso;
  }
}
