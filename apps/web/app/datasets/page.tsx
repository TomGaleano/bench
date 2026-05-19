"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Hero } from "../../components/ui/Hero";
import type { DatasetSummary, GitHubCase } from "../../lib/api";
import { createDataset, deleteDataset, listCases, listDatasets } from "../../lib/api";

const LANG_COLOR: Record<string, string> = {
  js: "#f0db4f",
  ts: "#3178c6",
  py: "#ffd43b",
  go: "#00add8",
  rs: "#dea584",
  rb: "#cc342d",
  java: "#b07219",
};

const KNOWN_LANGS = new Set(Object.keys(LANG_COLOR));

function deriveLangs(ds: DatasetSummary): string[] {
  const langs = ds.tags.filter((t) => KNOWN_LANGS.has(t.toLowerCase())).map((t) => t.toLowerCase());
  return Array.from(new Set(langs));
}

function deriveVersion(ds: DatasetSummary): string {
  const match = ds.tags.find((t) => /^v\d+$/i.test(t));
  return match ? match.toLowerCase() : "v1";
}

function deriveSpark(id: string): number[] {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  const points: number[] = [];
  let v = 4 + (Math.abs(h) % 6);
  for (let i = 0; i < 12; i++) {
    h = (h * 1103515245 + 12345) | 0;
    const delta = ((Math.abs(h) % 5) - 1);
    v = Math.max(2, Math.min(16, v + delta));
    points.push(v);
  }
  return points;
}

export default function DatasetsPage() {
  const [datasets, setDatasets] = useState<DatasetSummary[]>([]);
  const [cases, setCases] = useState<GitHubCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [newSlug, setNewSlug] = useState("");
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [selectedCaseIds, setSelectedCaseIds] = useState<Set<string>>(new Set());

  async function load() {
    try {
      const [ds, cs] = await Promise.all([listDatasets(), listCases()]);
      setDatasets(ds);
      setCases(cs.filter((c) => c.status === "frozen"));
      setLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleCreate() {
    if (!newSlug.trim() || !newName.trim()) return;
    try {
      const payload: { slug: string; name: string; description?: string; caseIds?: string[] } = {
        slug: newSlug.trim(),
        name: newName.trim(),
        caseIds: Array.from(selectedCaseIds),
      };
      const desc = newDesc.trim();
      if (desc) payload.description = desc;
      await createDataset(payload);
      setShowCreate(false);
      setNewSlug("");
      setNewName("");
      setNewDesc("");
      setSelectedCaseIds(new Set());
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleDelete(slug: string) {
    if (!confirm(`Delete dataset "${slug}"?`)) return;
    try {
      await deleteDataset(slug);
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

  const frozenCaseCount = cases.length;

  return (
    <div className="ds-page">
      <Hero
        eyebrow="Library · Datasets"
        title={
          <>
            <em>Reusable</em> benchmark suites.
          </>
        }
        lede="Datasets are versioned bundles of frozen cases. Compose them once; rerun every model against the same set forever."
      />

      {error && (
        <div className="mdl-err" style={{ margin: "32px auto" }}>
          <h3>Couldn&apos;t load datasets</h3>
          <p>{error}</p>
        </div>
      )}

      {loading ? (
        <div className="mdl-loading">
          <span className="pulse" />
          Loading datasets…
        </div>
      ) : (
        <div className="ds-grid">
          <button
            className="ds-card new"
            onClick={() => setShowCreate(true)}
            type="button"
            aria-label="Create new dataset"
          >
            <div className="plus" aria-hidden="true">
              +
            </div>
            <div className="ds-new-title">New dataset</div>
            <div className="ds-new-hint">
              Pick from {frozenCaseCount} frozen case{frozenCaseCount === 1 ? "" : "s"}.
            </div>
          </button>

          {datasets.map((d) => (
            <DatasetCard
              key={d.id}
              dataset={d}
              onDelete={() => handleDelete(d.slug)}
            />
          ))}
        </div>
      )}

      {showCreate && (
        <CreateDatasetDialog
          cases={cases}
          desc={newDesc}
          name={newName}
          onCancel={() => setShowCreate(false)}
          onChangeDesc={setNewDesc}
          onChangeName={setNewName}
          onChangeSlug={setNewSlug}
          onSubmit={handleCreate}
          onToggleCase={toggleCase}
          selectedCaseIds={selectedCaseIds}
          slug={newSlug}
        />
      )}
    </div>
  );
}

function DatasetCard({
  dataset,
  onDelete,
}: {
  dataset: DatasetSummary;
  onDelete: () => void;
}) {
  const langs = useMemo(() => deriveLangs(dataset), [dataset]);
  const version = useMemo(() => deriveVersion(dataset), [dataset]);
  const spark = useMemo(() => deriveSpark(dataset.id), [dataset.id]);
  const max = Math.max(...spark);

  return (
    <div className="ds-card">
      <Link className="ds-card-link" href={`/datasets/${dataset.slug}`}>
        <div className="ds-version">{version}</div>
        <div className="ds-id">{dataset.slug}</div>
        <div className="ds-ti">{dataset.name}</div>
        {dataset.description && <div className="ds-desc">{dataset.description}</div>}
        <div className="ds-spark" title="case growth over versions" aria-hidden="true">
          {spark.map((v, i) => (
            <i
              key={i}
              className={v >= max * 0.75 ? "tall" : ""}
              style={{ height: `${Math.max(3, (v / max) * 100)}%` }}
            />
          ))}
        </div>
        <div className="ds-foot">
          <span className="ds-count">
            {dataset.caseCount}
            <span className="u">case{dataset.caseCount === 1 ? "" : "s"}</span>
          </span>
          <div className="ds-langs">
            {langs.length === 0 ? (
              <span className="ds-status">{dataset.status}</span>
            ) : (
              langs.map((l) => (
                <span
                  key={l}
                  className="ds-lang"
                  title={l}
                  style={{ background: LANG_COLOR[l] ?? "#888" }}
                />
              ))
            )}
          </div>
        </div>
      </Link>
      <button
        aria-label={`Delete ${dataset.name}`}
        className="ds-delete"
        onClick={onDelete}
        type="button"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4">
          <path d="M3 3l6 6M9 3l-6 6" />
        </svg>
      </button>
    </div>
  );
}

function CreateDatasetDialog({
  cases,
  desc,
  name,
  onCancel,
  onChangeDesc,
  onChangeName,
  onChangeSlug,
  onSubmit,
  onToggleCase,
  selectedCaseIds,
  slug,
}: {
  cases: GitHubCase[];
  desc: string;
  name: string;
  onCancel: () => void;
  onChangeDesc: (value: string) => void;
  onChangeName: (value: string) => void;
  onChangeSlug: (value: string) => void;
  onSubmit: () => void;
  onToggleCase: (id: string) => void;
  selectedCaseIds: Set<string>;
  slug: string;
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onCancel]);

  const canSubmit = slug.trim() && name.trim();

  return (
    <>
      <div className="mdl-drawer-bg" onClick={onCancel} />
      <div className="mdl-drawer ds-create" role="dialog" aria-modal="true" aria-label="Create dataset">
        <div className="mdl-drawer-hd" style={{ position: "relative" }}>
          <button aria-label="Close" className="close" onClick={onCancel} type="button">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M3 3l6 6M9 3l-6 6" />
            </svg>
          </button>
          <span className="mdl-vendor">
            <span className="dot" style={{ background: "var(--accent)" }} />
            New dataset
          </span>
          <h2 className="ti">
            <em>Pick</em> the cases worth rerunning.
          </h2>
          <div className="id-row">{selectedCaseIds.size} selected</div>
        </div>
        <div className="mdl-drawer-body">
          <div className="dsn-form">
            <input
              aria-label="Slug"
              className="dsn-input"
              onChange={(e) => onChangeSlug(e.target.value)}
              placeholder="slug-url-name"
              value={slug}
            />
            <input
              aria-label="Display name"
              className="dsn-input title"
              onChange={(e) => onChangeName(e.target.value)}
              placeholder="Untitled benchmark suite"
              value={name}
            />
            <textarea
              aria-label="Description"
              className="dsn-input area"
              onChange={(e) => onChangeDesc(e.target.value)}
              placeholder="One-line description…"
              value={desc}
            />
          </div>

          <div className="mdl-drawer-section" style={{ marginTop: 24 }}>
            <div className="lab">Frozen cases · {cases.length} available</div>
            <div className="dsn-cases">
              {cases.length === 0 ? (
                <div className="dsn-empty">No frozen cases yet — freeze a case first.</div>
              ) : (
                cases.map((c) => {
                  const added = selectedCaseIds.has(c.id);
                  return (
                    <div
                      key={c.id}
                      className={"dsn-case-row" + (added ? " added" : "")}
                      onClick={() => onToggleCase(c.id)}
                    >
                      <div className="check">
                        <svg
                          width="11"
                          height="11"
                          viewBox="0 0 12 12"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
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
          <button className="btn2" onClick={onCancel} type="button">
            Cancel
          </button>
          <button
            className="btn2 primary"
            disabled={!canSubmit}
            onClick={onSubmit}
            style={{ marginLeft: "auto" }}
            type="button"
          >
            Create dataset · {selectedCaseIds.size} case{selectedCaseIds.size === 1 ? "" : "s"}
          </button>
        </div>
      </div>
    </>
  );
}

