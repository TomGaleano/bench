"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Hero } from "../../../components/ui/Hero";
import type { DatasetDetail, GitHubCase } from "../../../lib/api";
import {
  addCasesToDataset,
  getDataset,
  listCases,
  removeCaseFromDataset,
} from "../../../lib/api";

type CaseRow = DatasetDetail["cases"][number];

function titleAccent(name: string) {
  const words = name.trim().split(/\s+/);
  if (words.length < 2) return <>{name}</>;
  const head = words.slice(0, 1).join(" ");
  const rest = words.slice(1).join(" ");
  return (
    <>
      <em>{head}</em> {rest}
    </>
  );
}

export default function DatasetDetailPage() {
  const params = useParams();
  const slug = params.slug as string;

  const [dataset, setDataset] = useState<DatasetDetail | null>(null);
  const [pool, setPool] = useState<GitHubCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [showAdd, setShowAdd] = useState(false);
  const [selectedCaseIds, setSelectedCaseIds] = useState<Set<string>>(new Set());

  async function load() {
    try {
      const [ds, allCases] = await Promise.all([getDataset(slug), listCases()]);
      setDataset(ds);
      const existingIds = new Set(ds.cases.map((c) => c.id));
      setPool(allCases.filter((c) => c.status === "frozen" && !existingIds.has(c.id)));
      setLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [slug]);

  const statuses = useMemo(() => {
    if (!dataset) return [] as string[];
    return Array.from(new Set(dataset.cases.map((c) => c.status))).sort();
  }, [dataset]);

  const filtered = useMemo(() => {
    if (!dataset) return [] as CaseRow[];
    const needle = q.trim().toLowerCase();
    return dataset.cases.filter((c) => {
      if (statusFilter !== "all" && c.status !== statusFilter) return false;
      if (needle) {
        return (
          c.title.toLowerCase().includes(needle) ||
          c.repo.toLowerCase().includes(needle) ||
          c.slug.toLowerCase().includes(needle)
        );
      }
      return true;
    });
  }, [dataset, q, statusFilter]);

  async function handleAdd() {
    if (selectedCaseIds.size === 0) return;
    try {
      await addCasesToDataset(slug, Array.from(selectedCaseIds));
      setShowAdd(false);
      setSelectedCaseIds(new Set());
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleRemove(caseId: string) {
    if (!confirm("Remove this case from the dataset?")) return;
    try {
      await removeCaseFromDataset(slug, caseId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function toggleCase(id: string) {
    setSelectedCaseIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (loading) {
    return (
      <div className="mdl-loading">
        <span className="pulse" />
        Loading dataset…
      </div>
    );
  }

  if (error) {
    return (
      <div className="mdl-err">
        <h3>Couldn&apos;t load dataset</h3>
        <p>{error}</p>
      </div>
    );
  }

  if (!dataset) {
    return (
      <div className="mdl-err">
        <h3>Not found</h3>
        <p>Dataset does not exist.</p>
      </div>
    );
  }

  const ds = dataset.dataset;

  return (
    <div className="mdl-page">
      <Hero
        eyebrow="Library · Dataset"
        title={titleAccent(ds.name)}
        lede={ds.description || "Versioned bundle of frozen cases for repeatable benchmarks."}
        meta={[
          ["Cases", String(dataset.cases.length)],
          ["Status", ds.status],
          ["Created", new Date(ds.createdAt).toLocaleDateString()],
        ]}
        actions={
          <>
            <Link className="btn2" href="/datasets">
              ← All datasets
            </Link>
            <button className="btn2 primary" onClick={() => setShowAdd(true)} type="button">
              + Add cases
            </button>
          </>
        }
      />

      <div className="mdl-filters">
        <div className="search">
          <svg
            aria-hidden="true"
            width="13"
            height="13"
            viewBox="0 0 13 13"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <circle cx="5.5" cy="5.5" r="3.5" />
            <path d="M8.5 8.5L11 11" />
          </svg>
          <input
            aria-label="Search cases"
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search title, repo, or slug…"
            value={q}
          />
        </div>
        <button
          className={"mdl-chip" + (statusFilter === "all" ? " on" : "")}
          onClick={() => setStatusFilter("all")}
          type="button"
        >
          All<span className="ct">{dataset.cases.length}</span>
        </button>
        {statuses.map((s) => {
          const count = dataset.cases.filter((c) => c.status === s).length;
          return (
            <button
              key={s}
              className={"mdl-chip" + (statusFilter === s ? " on" : "")}
              onClick={() => setStatusFilter(s)}
              type="button"
            >
              {s}
              <span className="ct">{count}</span>
            </button>
          );
        })}
      </div>

      {dataset.cases.length === 0 ? (
        <div className="mdl-loading" style={{ fontStyle: "italic" }}>
          Empty dataset — add frozen cases to build your benchmark collection.
        </div>
      ) : (
        <table className="mdl-table">
          <thead>
            <tr>
              <th>Case</th>
              <th style={{ width: 220 }}>Repo</th>
              <th style={{ width: 120 }}>Status</th>
              <th style={{ width: 60 }} />
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => (
              <tr key={c.id} onClick={() => (window.location.href = `/cases/${c.id}`)}>
                <td>
                  <div className="mdl-name">
                    <div className="ti">{c.title}</div>
                    <div className="id">{c.slug}</div>
                  </div>
                </td>
                <td>
                  <span className="mdl-vendor">
                    <span className="dot" style={{ background: "var(--ink-4)" }} />
                    {c.repo}
                  </span>
                </td>
                <td>
                  <span className={`mdl-tag ${c.status === "frozen" ? "free" : ""}`}>
                    {c.status}
                  </span>
                </td>
                <td onClick={(e) => e.stopPropagation()}>
                  <button
                    aria-label={`Remove ${c.title}`}
                    className="ds-row-remove"
                    onClick={() => handleRemove(c.id)}
                    type="button"
                  >
                    <svg
                      width="11"
                      height="11"
                      viewBox="0 0 12 12"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                    >
                      <path d="M3 3l6 6M9 3l-6 6" />
                    </svg>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {dataset.cases.length > 0 && (
        <div className="mdl-foot">
          <span>
            {filtered.length} of {dataset.cases.length} cases
          </span>
          <span>Slug · {ds.slug}</span>
        </div>
      )}

      {showAdd && (
        <AddCasesDrawer
          pool={pool}
          selectedCaseIds={selectedCaseIds}
          onClose={() => {
            setShowAdd(false);
            setSelectedCaseIds(new Set());
          }}
          onSubmit={handleAdd}
          onToggle={toggleCase}
        />
      )}
    </div>
  );
}

function AddCasesDrawer({
  onClose,
  onSubmit,
  onToggle,
  pool,
  selectedCaseIds,
}: {
  onClose: () => void;
  onSubmit: () => void;
  onToggle: (id: string) => void;
  pool: GitHubCase[];
  selectedCaseIds: Set<string>;
}) {
  const [needle, setNeedle] = useState("");
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const matches = useMemo(() => {
    const q = needle.trim().toLowerCase();
    if (!q) return pool;
    return pool.filter(
      (c) => c.title.toLowerCase().includes(q) || c.id.toLowerCase().includes(q),
    );
  }, [pool, needle]);

  return (
    <>
      <div className="mdl-drawer-bg" onClick={onClose} />
      <div className="mdl-drawer ds-create" role="dialog" aria-modal="true" aria-label="Add cases">
        <div className="mdl-drawer-hd" style={{ position: "relative" }}>
          <button aria-label="Close" className="close" onClick={onClose} type="button">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M3 3l6 6M9 3l-6 6" />
            </svg>
          </button>
          <span className="mdl-vendor">
            <span className="dot" style={{ background: "var(--accent)" }} />
            Add cases
          </span>
          <h2 className="ti">
            <em>Pick</em> frozen cases to include.
          </h2>
          <div className="id-row">{selectedCaseIds.size} selected</div>
        </div>
        <div className="mdl-drawer-body">
          <input
            aria-label="Search pool"
            className="dsn-input"
            onChange={(e) => setNeedle(e.target.value)}
            placeholder="Search by title or id…"
            value={needle}
          />
          <div className="mdl-drawer-section" style={{ marginTop: 16 }}>
            <div className="lab">Frozen pool · {matches.length} available</div>
            <div className="dsn-cases">
              {matches.length === 0 ? (
                <div className="dsn-empty">
                  {pool.length === 0
                    ? "No frozen cases available — freeze a case first."
                    : "No cases match that search."}
                </div>
              ) : (
                matches.map((c) => {
                  const added = selectedCaseIds.has(c.id);
                  return (
                    <div
                      key={c.id}
                      className={"dsn-case-row" + (added ? " added" : "")}
                      onClick={() => onToggle(c.id)}
                    >
                      <div className="check">
                        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M2 6.5L5 9.5L10 3.5" />
                        </svg>
                      </div>
                      <div className="case-main">
                        <div className="ti">{c.title}</div>
                        <div className="id">{c.id}</div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
        <div className="mdl-drawer-foot">
          <button className="btn2" onClick={onClose} type="button">
            Cancel
          </button>
          <button
            className="btn2 primary"
            disabled={selectedCaseIds.size === 0}
            onClick={onSubmit}
            style={{ marginLeft: "auto" }}
            type="button"
          >
            Add {selectedCaseIds.size} case{selectedCaseIds.size === 1 ? "" : "s"}
          </button>
        </div>
      </div>
    </>
  );
}
