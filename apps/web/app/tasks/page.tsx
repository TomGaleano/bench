"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Hero } from "../../components/ui/Hero";
import type { GitHubCase } from "../../lib/api";
import { listCases } from "../../lib/api";

type StatusKey = "all" | "frozen" | "draft" | "building" | "ready" | "rejected" | "archived";

const STATUS_CHIPS: Array<[StatusKey, string]> = [
  ["all", "All"],
  ["frozen", "Frozen"],
  ["ready", "Ready"],
  ["building", "Building"],
  ["draft", "Draft"],
  ["rejected", "Rejected"],
];

function repoOwner(repo: string) {
  return repo.split("/")[0] || "—";
}

export default function TasksPage() {
  const [cases, setCases] = useState<GitHubCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusKey>("all");
  const [sort, setSort] = useState<"newest" | "title" | "repo">("newest");

  useEffect(() => {
    let cancelled = false;
    listCases()
      .then((data) => {
        if (!cancelled) {
          setCases(data);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const counts = useMemo(() => {
    const c: Record<StatusKey, number> = {
      all: cases.length,
      frozen: 0,
      draft: 0,
      building: 0,
      ready: 0,
      rejected: 0,
      archived: 0,
    };
    for (const k of cases) {
      const s = k.status as StatusKey;
      if (s in c) c[s]++;
    }
    return c;
  }, [cases]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const result = cases.filter((k) => {
      if (statusFilter !== "all" && k.status !== statusFilter) return false;
      if (needle) {
        return (
          k.title.toLowerCase().includes(needle) ||
          k.id.toLowerCase().includes(needle) ||
          k.labels.some((l) => l.toLowerCase().includes(needle))
        );
      }
      return true;
    });

    result.sort((a, b) => {
      if (sort === "title") return a.title.localeCompare(b.title);
      if (sort === "repo") {
        const ar = String(a.metadata?.repo ?? a.id);
        const br = String(b.metadata?.repo ?? b.id);
        return ar.localeCompare(br);
      }
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
    return result;
  }, [cases, q, sort, statusFilter]);

  const repos = useMemo(() => {
    const set = new Set<string>();
    for (const c of cases) {
      const repo = c.metadata?.repo;
      if (typeof repo === "string") set.add(repo);
    }
    return set;
  }, [cases]);

  return (
    <div className="mdl-page">
      <Hero
        eyebrow="Library · Tasks"
        title={
          <>
            Curate <em>verified</em> tasks.
          </>
        }
        lede="Every task is a real GitHub issue, base repo state, and fail-to-pass tests. Filter the queue, freeze the ones worth running, then send them off to a benchmark."
        meta={[
          ["Total", String(cases.length)],
          ["Repos", String(repos.size)],
          ["Verified", String(counts.frozen)],
        ]}
        actions={
          <>
            <button className="btn2" type="button" disabled title="Coming soon">
              Import
            </button>
            <Link className="btn2 primary" href="/cases/new">
              New case
            </Link>
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
            aria-label="Search tasks"
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search task, repo, or label…"
            value={q}
          />
        </div>
        {STATUS_CHIPS.map(([k, label]) => (
          <button
            key={k}
            className={"mdl-chip" + (statusFilter === k ? " on" : "")}
            onClick={() => setStatusFilter(k)}
            type="button"
          >
            {label}
            <span className="ct">{counts[k]}</span>
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <select
          aria-label="Sort tasks"
          className="mdl-sort"
          onChange={(e) => setSort(e.target.value as "newest" | "title" | "repo")}
          value={sort}
        >
          <option value="newest">Sort · Newest</option>
          <option value="title">Sort · Title</option>
          <option value="repo">Sort · Repo</option>
        </select>
      </div>

      {loading && (
        <div className="mdl-loading">
          <span className="pulse" />
          Loading tasks…
        </div>
      )}

      {error && (
        <div className="mdl-err">
          <h3>Couldn&apos;t load tasks</h3>
          <p>{error}</p>
        </div>
      )}

      {!loading && !error && cases.length === 0 && (
        <div className="mdl-loading" style={{ fontStyle: "italic" }}>
          No tasks loaded — import a dataset or create a new case to start the library.
        </div>
      )}

      {!loading && !error && cases.length > 0 && filtered.length === 0 && (
        <div className="mdl-loading" style={{ fontStyle: "italic" }}>
          No tasks match those filters.
        </div>
      )}

      {!loading && !error && filtered.length > 0 && (
        <table className="mdl-table">
          <thead>
            <tr>
              <th>Task</th>
              <th style={{ width: 200 }}>Repo</th>
              <th style={{ width: 140 }}>Status</th>
              <th style={{ width: 110 }} className="num">
                Labels
              </th>
              <th style={{ width: 110 }} className="num">
                Created
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => {
              const repo = typeof c.metadata?.repo === "string" ? c.metadata.repo : "—";
              return (
                <tr
                  key={c.id}
                  onClick={() => (window.location.href = `/cases/${c.id}`)}
                >
                  <td>
                    <div className="mdl-name">
                      <div className="ti">{c.title}</div>
                      <div className="id">{c.id}</div>
                      {c.labels.length > 0 && (
                        <div className="mdl-tags" style={{ marginTop: 6 }}>
                          {c.labels.slice(0, 4).map((l) => (
                            <span key={l} className="mdl-tag">
                              {l}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </td>
                  <td>
                    <span className="mdl-vendor">
                      <span className="dot" style={{ background: "var(--ink-4)" }} />
                      {repo}
                    </span>
                    <div className="id" style={{ marginTop: 4, color: "var(--ink-4)" }}>
                      {repoOwner(repo)}
                    </div>
                  </td>
                  <td>
                    <span
                      className={
                        "mdl-tag " +
                        (c.status === "frozen"
                          ? "free"
                          : c.status === "rejected"
                            ? ""
                            : c.status === "ready" || c.status === "building"
                              ? "tool"
                              : "")
                      }
                    >
                      {c.status}
                    </span>
                  </td>
                  <td>
                    <div className="mdl-ctx">{c.labels.length}</div>
                  </td>
                  <td>
                    <div className="mdl-date">
                      {new Date(c.createdAt).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {!loading && !error && cases.length > 0 && (
        <div className="mdl-foot">
          <span>
            {filtered.length} of {cases.length} tasks
          </span>
          <span>Live from /api/github/cases</span>
        </div>
      )}
    </div>
  );
}
