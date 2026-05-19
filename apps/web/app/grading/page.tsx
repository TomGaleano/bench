"use client";

import { useEffect, useState } from "react";
import { EmptyState, LoadingState, PageHeader, SectionTitle, StatusPill } from "../../components/ui";
import { listRuns, type RunSummary } from "../../lib/api";

export default function PlanGradingPage() {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const planRuns = runs.filter((run) => run.mode === "plan_only");
  const needsReview = planRuns.filter((run) => run.status === "succeeded" && run.plan).length;

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      try {
        const next = await listRuns();
        if (!cancelled) {
          setRuns(next);
          setError("");
          setLoading(false);
        }
      } catch (refreshError) {
        if (!cancelled) {
          setError(refreshError instanceof Error ? refreshError.message : String(refreshError));
          setLoading(false);
        }
      }
    }

    void refresh();
    const interval = window.setInterval(refresh, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  return (
    <>
      <PageHeader
        eyebrow="Plan grading"
        title="Score plans before code."
        description="Compare plan quality across models with rubric-level evidence and judge-ready review states."
        meta={[["Rubric", "Not configured"], ["Plans", String(planRuns.length)], ["Needs review", String(needsReview)]]}
      />
      <SectionTitle kicker="Rubric" title="Plan quality queue" />
      {loading ? <LoadingState label="Loading plan queue" /> : null}
      {error ? <EmptyState title="Unable to load plans" description={error} /> : null}
      {!loading && !error && planRuns.length === 0 ? (
        <EmptyState title="No plans to grade" description="Planning-only runs and experiment drafts will populate this queue." />
      ) : null}
      {!loading && !error && planRuns.length > 0 ? (
        <div className="gradeGrid">
          {planRuns.map((run) => (
            <article className="panel gradeCard" key={run.id}>
              <div className="panelHeader">
                <div>
                  <StatusPill status={run.plan ? "needs review" : run.status} />
                  <h2>{run.modelId ?? "model pending"}</h2>
                  <p>{run.caseVersionId ?? "case pending"}</p>
                </div>
                <strong>{run.eventCount}</strong>
              </div>
              <dl>
                <div>
                  <dt>Plan artifact</dt>
                  <dd>{run.plan?.artifact ? "ready" : "pending"}</dd>
                </div>
                <div>
                  <dt>Session events</dt>
                  <dd>{run.eventCount}</dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>{run.status}</dd>
                </div>
              </dl>
              <p>{run.plan?.markdown?.slice(0, 220) ?? "Waiting for the Pi runner to finish the plan."}</p>
              <a className="button" href={`/replay?runId=${run.id}`}>Open replay</a>
            </article>
          ))}
        </div>
      ) : null}
    </>
  );
}
