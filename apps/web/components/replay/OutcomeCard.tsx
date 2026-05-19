import type { RunSummary } from "../../lib/api";

type OutcomeCardProps = {
  run: RunSummary;
  eventCount: number;
};

const OK_STATES = new Set(["succeeded"]);
const FAIL_STATES = new Set(["failed", "cancelled", "timed_out"]);

export function OutcomeCard({ eventCount, run }: OutcomeCardProps) {
  const status = run.status;
  const isOk = OK_STATES.has(status);
  const isFail = FAIL_STATES.has(status);
  const tone = isOk ? "ok" : isFail ? "fail" : "pending";

  return (
    <div className={`outcome-card tone-${tone}`}>
      <div className="outcome-hd">
        <span className="lab">Outcome</span>
        <span className="pill">{status}</span>
      </div>
      <div className="outcome-ti">
        {isOk ? "Resolved." : isFail ? "Did not resolve." : "In progress."}
      </div>
      <dl className="outcome-stats">
        <div>
          <dt>Events</dt>
          <dd>{eventCount}</dd>
        </div>
        <div>
          <dt>Mode</dt>
          <dd>{run.mode}</dd>
        </div>
        <div>
          <dt>Model</dt>
          <dd>{run.modelId ?? "—"}</dd>
        </div>
        <div>
          <dt>Started</dt>
          <dd>
            {run.startedAt
              ? new Date(run.startedAt).toLocaleTimeString()
              : "—"}
          </dd>
        </div>
      </dl>
    </div>
  );
}
