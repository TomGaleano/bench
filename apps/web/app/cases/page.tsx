import Link from "next/link";
import { PageHeader, SectionTitle, StatusPill } from "../../components/ui";
import { listCases } from "../../lib/api";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

export default async function CasesPage() {
  const cases = await listCases();

  return (
    <>
      <PageHeader
        eyebrow="Benchmark cases"
        title="All cases"
        description="Browse imported and frozen benchmark cases created from GitHub issues."
        meta={[["Total", String(cases.length)]]}
      />

      <section className="panel">
        <SectionTitle kicker="Cases" title="List" />
        {cases.length ? (
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Status</th>
                  <th>Labels</th>
                  <th>Created</th>
                  <th>Frozen</th>
                </tr>
              </thead>
              <tbody>
                {cases.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link href={`/cases/${c.id}`}>
                        <strong>{c.title}</strong>
                      </Link>
                    </td>
                    <td>
                      <StatusPill status={c.status} />
                    </td>
                    <td>
                      {c.labels.length ? (
                        <div className="tagList" aria-label="Case labels">
                          {c.labels.slice(0, 3).map((label) => (
                            <span key={label}>{label}</span>
                          ))}
                          {c.labels.length > 3 ? (
                            <span>+{c.labels.length - 3}</span>
                          ) : null}
                        </div>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>{formatDate(c.createdAt)}</td>
                    <td>{c.frozenAt ? "Yes" : "No"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="emptyState compact">
            <strong>No cases yet</strong>
            <p>
              <Link href="/cases/new">Create your first case →</Link>
            </p>
          </div>
        )}
      </section>
    </>
  );
}
