import Link from "next/link";
import { EmptyState, StatusPill } from "../../components/ui";
import { Hero } from "../../components/ui/Hero";
import type { BenchmarkExperiment } from "../../lib/api";
import { getBenchmarks } from "../../lib/api";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

export default async function BenchmarksPage() {
  let benchmarks: BenchmarkExperiment[] = [];
  let error: string | null = null;

  try {
    benchmarks = await getBenchmarks();
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  return (
    <div className="mdl-page">
      <Hero
        eyebrow="Benchmarks"
        title={
          <>
            <em>Head-to-head</em> agent experiments.
          </>
        }
        lede="Compare two agents across a frozen dataset of real GitHub issues. Each benchmark runs planning, implementation, and grading in parallel — then declares a winner."
        meta={[
          ["Total", String(benchmarks.length)],
          ["Running", String(benchmarks.filter((b) => b.status === "running").length)],
          ["Succeeded", String(benchmarks.filter((b) => b.status === "succeeded").length)],
        ]}
        actions={
          <Link className="btn2 primary" href="/benchmarks/new">
            New benchmark →
          </Link>
        }
      />

      {error && (
        <div className="mdl-err" style={{ margin: "24px auto" }}>
          <h3>Couldn&apos;t load benchmarks</h3>
          <p>{error}</p>
        </div>
      )}

      {!error && benchmarks.length === 0 ? (
        <EmptyState
          title="No benchmarks yet"
          description="Create a benchmark to pit two agents against each other on a frozen dataset."
        />
      ) : null}

      {!error && benchmarks.length > 0 ? (
        <div className="tableWrap" style={{ marginTop: 24 }}>
          <table className="mdl-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Dataset</th>
                <th>Status</th>
                <th>Agent 1</th>
                <th>Agent 2</th>
                <th style={{ width: 90 }} className="num">Cases</th>
                <th style={{ width: 90 }} className="num">Runs</th>
                <th style={{ width: 140 }}>Created</th>
              </tr>
            </thead>
            <tbody>
              {benchmarks
                .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                .map((benchmark) => (
                  <tr key={benchmark.id}>
                    <td>
                      <Link href={`/benchmarks/${benchmark.id}`}>
                        <div className="mdl-name">
                          <div className="ti">{benchmark.name}</div>
                          <div className="id">{benchmark.id.slice(0, 8)}</div>
                        </div>
                      </Link>
                    </td>
                    <td>
                      <span className="mdl-tag">{benchmark.datasetName ?? benchmark.datasetSlug}</span>
                    </td>
                    <td>
                      <StatusPill status={benchmark.status} />
                    </td>
                    <td>
                      <div className="mdl-name">
                        <div className="ti">
                          {benchmark.agent1ModelId?.split("/").pop() ?? "—"}
                        </div>
                        <div className="id">{benchmark.agent1Mode}</div>
                      </div>
                    </td>
                    <td>
                      <div className="mdl-name">
                        <div className="ti">
                          {benchmark.agent2ModelId?.split("/").pop() ?? "—"}
                        </div>
                        <div className="id">{benchmark.agent2Mode ?? "—"}</div>
                      </div>
                    </td>
                    <td>
                      <div className="mdl-ctx">{benchmark.totalCases}</div>
                    </td>
                    <td>
                      <div className="mdl-ctx">
                        {benchmark.completedRuns}
                        <span className="unit">/{benchmark.totalRuns}</span>
                      </div>
                    </td>
                    <td>{formatDate(benchmark.createdAt)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
