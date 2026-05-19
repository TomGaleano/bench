import Link from "next/link";
import { notFound } from "next/navigation";
import { GoldPatchPanel } from "../../../components/case/GoldPatchPanel";
import { CostScatter } from "../../../components/charts/CostScatter";
import { Hero } from "../../../components/ui/Hero";
import { SectionHeader } from "../../../components/ui/SectionHeader";
import type { CaseRunResult } from "../../../lib/api";
import {
  getCase,
  getCaseResults,
  getCaseVersionDetail,
  getCaseVersions,
} from "../../../lib/api";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

function titleAccent(title: string) {
  const words = title.trim().split(/\s+/);
  if (words.length < 2) return <>{title}</>;
  return (
    <>
      <em>{words[0]}</em> {words.slice(1).join(" ")}
    </>
  );
}

function statusToScore(status: string): number {
  if (status === "succeeded") return 100;
  if (status === "failed" || status === "timed_out" || status === "cancelled") return 0;
  return 50;
}

function aggregateResults(results: CaseRunResult[]) {
  const byModel = new Map<
    string,
    {
      modelId: string;
      runs: number;
      passed: number;
      cost: number;
      totalScore: number;
    }
  >();

  for (const r of results) {
    if (!r.modelId) continue;
    const existing = byModel.get(r.modelId) ?? {
      modelId: r.modelId,
      runs: 0,
      passed: 0,
      cost: 0,
      totalScore: 0,
    };
    existing.runs += 1;
    if (r.status === "succeeded") existing.passed += 1;
    existing.cost += r.chargedCost ?? r.computedCost ?? 0;
    existing.totalScore += statusToScore(r.status);
    byModel.set(r.modelId, existing);
  }

  return Array.from(byModel.values()).map((m) => ({
    modelId: m.modelId,
    runs: m.runs,
    passed: m.passed,
    e2e: m.runs === 0 ? 0 : m.totalScore / m.runs,
    costAvg: m.runs === 0 ? 0 : m.cost / m.runs,
  }));
}

export default async function CaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let caseData;
  try {
    caseData = await getCase(id);
  } catch {
    notFound();
  }

  const [versions, results] = await Promise.all([
    getCaseVersions(id),
    getCaseResults(id).catch(() => ({ caseId: id, versions: 0, results: [] as CaseRunResult[] })),
  ]);

  const latestVersion = versions[0];

  let versionDetail = null;
  if (latestVersion) {
    try {
      versionDetail = await getCaseVersionDetail(id, latestVersion.id);
    } catch {
      // ignore — still render overview
    }
  }

  const acceptedTests = versionDetail?.testSpecs.filter((t) => t.status === "accepted") ?? [];
  const rejectedTests = versionDetail?.testSpecs.filter((t) => t.status === "rejected") ?? [];
  const proposedTests = versionDetail?.testSpecs.filter((t) => t.status === "proposed") ?? [];

  const repo =
    typeof caseData.metadata?.repo === "string"
      ? caseData.metadata.repo
      : versionDetail
        ? `${versionDetail.repoOwner}/${versionDetail.repoName}`
        : "—";

  const aggregates = aggregateResults(results.results);
  const scatterPoints = aggregates.map((a) => ({
    id: a.modelId,
    label: a.modelId.split("/").pop() ?? a.modelId,
    cost: a.costAvg,
    score: a.e2e,
  }));

  return (
    <div className="mdl-page case-detail">
      <Hero
        eyebrow={`Verified task · ${repo}`}
        title={titleAccent(caseData.title)}
        lede={
          caseData.body && caseData.body.length > 0
            ? caseData.body.slice(0, 280)
            : "GitHub issue imported as a benchmark case. Pi runs against this case version to test plan and implementation quality."
        }
        meta={[
          ["Status", caseData.status],
          ["Versions", String(versions.length)],
          ["Runs", String(results.results.length)],
        ]}
        actions={
          <>
            <Link className="btn2" href="/tasks">
              ← All tasks
            </Link>
            <Link className="btn2 primary" href={`/experiments/new?caseId=${id}`}>
              Run experiment →
            </Link>
          </>
        }
      />

      <SectionHeader
        num="01"
        sub="Each dot is a model's average end-to-end score against this task vs. its average run cost. Pareto-optimal points are highlighted."
      >
        Model <em>scatter</em>
      </SectionHeader>
      <div className="card2">
        <CostScatter
          points={scatterPoints}
          emptyMessage="Run this case against a model to plot its score and cost here."
        />
      </div>

      <SectionHeader num="02">
        Gold <em>patch</em>
      </SectionHeader>
      <div className="card2">
        <GoldPatchPanel
          patch={
            typeof caseData.metadata?.goldPatch === "string"
              ? caseData.metadata.goldPatch
              : null
          }
          commitSha={versionDetail?.goldCommitSha ?? null}
        />
      </div>

      <SectionHeader num="03">
        Per-model <em>results</em>
        {aggregates.length > 0 ? ` — ${aggregates.length} models` : ""}
      </SectionHeader>
      {aggregates.length === 0 ? (
        <div className="lb-empty">
          <strong>No runs yet for this case</strong>
          <p>Launch an experiment to populate this table.</p>
        </div>
      ) : (
        <table className="mdl-table">
          <thead>
            <tr>
              <th>Model</th>
              <th style={{ width: 90 }} className="num">
                Runs
              </th>
              <th style={{ width: 90 }} className="num">
                Passed
              </th>
              <th style={{ width: 180 }}>End-to-end</th>
              <th style={{ width: 120 }} className="num">
                Avg cost
              </th>
            </tr>
          </thead>
          <tbody>
            {aggregates
              .sort((a, b) => b.e2e - a.e2e)
              .map((row) => {
                const max = Math.max(...aggregates.map((a) => a.e2e), 1);
                return (
                  <tr key={row.modelId}>
                    <td>
                      <div className="mdl-name">
                        <div className="ti">{row.modelId.split("/").pop()}</div>
                        <div className="id">{row.modelId}</div>
                      </div>
                    </td>
                    <td>
                      <div className="mdl-ctx">{row.runs}</div>
                    </td>
                    <td>
                      <div className="mdl-ctx">
                        {row.passed}
                        <span className="unit">/{row.runs}</span>
                      </div>
                    </td>
                    <td>
                      <div className="bar2 accent">
                        <span className="v">{row.e2e.toFixed(0)}%</span>
                        <span className="track">
                          <i style={{ width: `${(row.e2e / max) * 100}%` }} />
                        </span>
                      </div>
                    </td>
                    <td>
                      <div className="mdl-price">
                        <span className="v">${row.costAvg.toFixed(4)}</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      )}

      <SectionHeader num="04">
        Case <em>metadata</em>
      </SectionHeader>
      <dl className="case-meta">
        <div>
          <dt>Slug</dt>
          <dd>{(caseData.metadata?.slug as string) ?? "—"}</dd>
        </div>
        <div>
          <dt>Created</dt>
          <dd>{formatDate(caseData.createdAt)}</dd>
        </div>
        <div>
          <dt>Updated</dt>
          <dd>{formatDate(caseData.updatedAt)}</dd>
        </div>
        <div>
          <dt>Frozen</dt>
          <dd>{caseData.frozenAt ? formatDate(caseData.frozenAt) : "No"}</dd>
        </div>
        <div>
          <dt>Repo</dt>
          <dd>{repo}</dd>
        </div>
        {versionDetail?.baseCommitSha && (
          <div>
            <dt>Base commit</dt>
            <dd>
              <code>{versionDetail.baseCommitSha.slice(0, 12)}</code>
            </dd>
          </div>
        )}
        <div>
          <dt>Labels</dt>
          <dd>
            {caseData.labels.length > 0 ? (
              <div className="mdl-tags">
                {caseData.labels.map((l) => (
                  <span key={l} className="mdl-tag">
                    {l}
                  </span>
                ))}
              </div>
            ) : (
              "None"
            )}
          </dd>
        </div>
      </dl>

      {versionDetail && (
        <>
          <SectionHeader num="05">
            Test <em>specs</em>
          </SectionHeader>
          <div className="case-tests-summary">
            <span className="case-tests-pip case-tests-ok">
              <strong>{acceptedTests.length}</strong> accepted
            </span>
            <span className="case-tests-pip case-tests-fail">
              <strong>{rejectedTests.length}</strong> rejected
            </span>
            <span className="case-tests-pip case-tests-pending">
              <strong>{proposedTests.length}</strong> proposed
            </span>
          </div>

          {acceptedTests.length > 0 && (
            <TestTable title="Accepted" tests={acceptedTests} />
          )}
          {rejectedTests.length > 0 && (
            <TestTable title="Rejected" tests={rejectedTests} />
          )}
          {proposedTests.length > 0 && (
            <TestTable title="Proposed" tests={proposedTests} />
          )}
        </>
      )}

      {versionDetail?.validationAttempts.length ? (
        <>
          <SectionHeader num="06">
            Validation <em>history</em>
          </SectionHeader>
          <div className="validation-grid">
            {versionDetail.validationAttempts.map((va) => (
              <div className="card2" key={va.id}>
                <div className="card2-hd">
                  <span className="card2-ti">{va.status}</span>
                  <span style={{ color: "var(--ink-4)", fontFamily: "var(--mono)", fontSize: 11 }}>
                    {formatDate(va.finishedAt)}
                  </span>
                </div>
                <dl className="case-meta inline">
                  <div>
                    <dt>Accepted</dt>
                    <dd>{va.acceptedTestCount}</dd>
                  </div>
                  <div>
                    <dt>Rejected</dt>
                    <dd>{va.rejectedTestCount}</dd>
                  </div>
                  <div>
                    <dt>Runner</dt>
                    <dd>{va.runnerVersion}</dd>
                  </div>
                </dl>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

type TestSpec = {
  id: string;
  name: string;
  kind: string;
  filePath: string | null;
  testCommand: string;
};

function TestTable({ tests, title }: { tests: TestSpec[]; title: string }) {
  return (
    <>
      <h3
        style={{
          color: "var(--ink-4)",
          fontFamily: "var(--mono)",
          fontSize: 11,
          letterSpacing: "0.08em",
          margin: "18px 0 8px",
          textTransform: "uppercase",
        }}
      >
        {title}
      </h3>
      <table className="mdl-table">
        <thead>
          <tr>
            <th>Name</th>
            <th style={{ width: 100 }}>Kind</th>
            <th>File</th>
            <th>Command</th>
          </tr>
        </thead>
        <tbody>
          {tests.map((t) => (
            <tr key={t.id}>
              <td>
                <div className="mdl-name">
                  <div className="ti">{t.name}</div>
                </div>
              </td>
              <td>
                <span className="mdl-tag">{t.kind}</span>
              </td>
              <td>
                <code style={{ fontFamily: "var(--mono)", fontSize: 11 }}>
                  {t.filePath ?? "—"}
                </code>
              </td>
              <td>
                <code style={{ fontFamily: "var(--mono)", fontSize: 11 }}>
                  {t.testCommand}
                </code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
