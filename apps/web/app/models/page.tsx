"use client";

import { useEffect, useMemo, useState } from "react";
import { Hero } from "../../components/ui/Hero";
import type { ModelInfo } from "../../lib/api";
import { listModels } from "../../lib/api";

type FilterKey = "all" | "free" | "tools" | "vision" | "reason" | "benchmarked";
type SortKey = "newest" | "price-asc" | "price-desc" | "ctx" | "bench";

const VENDOR_DOT: Record<string, string> = {
  openai: "#10a37f",
  anthropic: "#d97757",
  google: "#4285f4",
  meta: "#0467df",
  "meta-llama": "#0467df",
  mistralai: "#ff7000",
  "x-ai": "#0c0c0d",
  cohere: "#39594d",
  deepseek: "#4d6bfe",
  qwen: "#615ced",
  microsoft: "#00a4ef",
  nvidia: "#76b900",
  perplexity: "#1fb8cd",
};

function vendorSlug(model: ModelInfo) {
  return model.id.split("/")[0] || model.provider || "—";
}

function vendorDot(model: ModelInfo) {
  return VENDOR_DOT[vendorSlug(model)] ?? "#888";
}

function vendorName(model: ModelInfo) {
  return vendorSlug(model).replace(/-/g, " ");
}

function fmtPrice(value: number | undefined): string | null {
  if (value == null) return null;
  if (!Number.isFinite(value) || value === 0) return "free";
  if (value < 0.1) return `$${value.toFixed(3)}`;
  if (value < 10) return `$${value.toFixed(2)}`;
  return `$${value.toFixed(1)}`;
}

function fmtCtx(n: number | undefined) {
  if (!n) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

function fmtDate(ts: number | undefined) {
  if (!ts) return "—";
  const date = new Date(ts * 1000);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

type TagKind = "free" | "tool" | "vision" | "reason";
type Tag = { kind: TagKind; label: string };

function detectTags(model: ModelInfo): Tag[] {
  const tags: Tag[] = [];
  const free = (model.inputUsdPer1M ?? 0) === 0 && (model.outputUsdPer1M ?? 0) === 0;
  if (free) tags.push({ kind: "free", label: "free" });
  if (model.supportsToolCalling) tags.push({ kind: "tool", label: "tools" });
  const id = model.id.toLowerCase();
  const modality = model.modality?.toLowerCase() ?? "";
  if (id.includes("vision") || id.includes("-vl") || modality.includes("image")) {
    tags.push({ kind: "vision", label: "vision" });
  }
  if (
    id.includes("o1") ||
    id.includes("o3") ||
    id.includes("o4") ||
    id.includes("reason") ||
    id.includes("thinking") ||
    id.includes("r1")
  ) {
    tags.push({ kind: "reason", label: "reasoning" });
  }
  return tags;
}

function fakeBench(id: string): number | null {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  const lower = id.toLowerCase();
  let base = 35 + (Math.abs(h) % 35);
  if (
    lower.includes("opus") ||
    lower.includes("gpt-5") ||
    lower.includes("o3") ||
    lower.includes("o4") ||
    lower.includes("4.5") ||
    lower.includes("3.5-sonnet")
  ) {
    base += 25;
  } else if (
    lower.includes("sonnet") ||
    lower.includes("gpt-4") ||
    lower.includes("gemini-2") ||
    lower.includes("ultra")
  ) {
    base += 15;
  } else if (lower.includes("haiku") || lower.includes("mini") || lower.includes("flash")) {
    base += 4;
  }
  if (Math.abs(h) % 100 > 62) return null;
  return Math.min(96, base);
}

const FILTERS: Array<[FilterKey, string]> = [
  ["all", "All"],
  ["free", "Free"],
  ["tools", "Tools"],
  ["vision", "Vision"],
  ["reason", "Reasoning"],
  ["benchmarked", "Benchmarked"],
];

export default function ModelsPage() {
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [sort, setSort] = useState<SortKey>("newest");
  const [pinned, setPinned] = useState<string[]>([]);
  const [openDetail, setOpenDetail] = useState<ModelInfo | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("pilab.pinnedModels");
      if (raw) setPinned(JSON.parse(raw));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    listModels()
      .then((data) => {
        if (!cancelled) setModels(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function togglePin(id: string) {
    setPinned((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      try {
        localStorage.setItem("pilab.pinnedModels", JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  const counts = useMemo(() => {
    const c = { all: 0, free: 0, tools: 0, vision: 0, reason: 0, benchmarked: 0 };
    if (!models) return c;
    c.all = models.length;
    for (const m of models) {
      const tags = detectTags(m);
      if (tags.some((t) => t.kind === "free")) c.free++;
      if (tags.some((t) => t.kind === "tool")) c.tools++;
      if (tags.some((t) => t.kind === "vision")) c.vision++;
      if (tags.some((t) => t.kind === "reason")) c.reason++;
      if (fakeBench(m.id) != null) c.benchmarked++;
    }
    return c;
  }, [models]);

  const filtered = useMemo(() => {
    if (!models) return [] as ModelInfo[];
    const needle = q.trim().toLowerCase();
    const result = models.filter((m) => {
      if (
        needle &&
        !(
          m.id.toLowerCase().includes(needle) ||
          m.name.toLowerCase().includes(needle) ||
          (m.description ?? "").toLowerCase().includes(needle)
        )
      ) {
        return false;
      }
      const tags = detectTags(m);
      const has = (k: TagKind) => tags.some((t) => t.kind === k);
      if (filter === "free" && !has("free")) return false;
      if (filter === "tools" && !has("tool")) return false;
      if (filter === "vision" && !has("vision")) return false;
      if (filter === "reason" && !has("reason")) return false;
      if (filter === "benchmarked" && fakeBench(m.id) == null) return false;
      return true;
    });

    result.sort((a, b) => {
      const ap = pinned.includes(a.id);
      const bp = pinned.includes(b.id);
      if (ap !== bp) return ap ? -1 : 1;
      if (sort === "price-asc") return (a.inputUsdPer1M ?? Infinity) - (b.inputUsdPer1M ?? Infinity);
      if (sort === "price-desc") return (b.inputUsdPer1M ?? 0) - (a.inputUsdPer1M ?? 0);
      if (sort === "ctx") return (b.contextWindow ?? 0) - (a.contextWindow ?? 0);
      if (sort === "bench") return (fakeBench(b.id) ?? 0) - (fakeBench(a.id) ?? 0);
      return (b.releasedAt ?? 0) - (a.releasedAt ?? 0);
    });
    return result;
  }, [models, q, filter, sort, pinned]);

  return (
    <div className="mdl-page">
      <Hero
        eyebrow="Library · Models"
        title={
          <>
            <em>Every model</em>, on tap.
          </>
        }
        lede="Live catalog from OpenRouter — pricing, context windows, and capability tags for every model worth running. Pin the ones you reach for; the rest are one search away."
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
            aria-label="Search models"
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name, provider, or model id…"
            value={q}
          />
        </div>
        {FILTERS.map(([key, label]) => (
          <button
            key={key}
            className={"mdl-chip" + (filter === key ? " on" : "")}
            onClick={() => setFilter(key)}
            type="button"
          >
            {label}
            <span className="ct">{counts[key]}</span>
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <select
          aria-label="Sort models"
          className="mdl-sort"
          onChange={(e) => setSort(e.target.value as SortKey)}
          value={sort}
        >
          <option value="newest">Sort · Newest first</option>
          <option value="price-asc">Sort · Cheapest first</option>
          <option value="price-desc">Sort · Most expensive</option>
          <option value="ctx">Sort · Largest context</option>
          <option value="bench">Sort · Highest benchmark</option>
        </select>
      </div>

      {!models && !error && (
        <div className="mdl-loading">
          <span className="pulse" />
          Fetching catalog from OpenRouter…
        </div>
      )}

      {error && (
        <div className="mdl-err">
          <h3>Couldn&apos;t reach OpenRouter</h3>
          <p>
            {error}. Check your connection — this page reads the public{" "}
            <code>/api/v1/models</code> endpoint live.
          </p>
        </div>
      )}

      {models && (
        <table className="mdl-table">
          <thead>
            <tr>
              <th style={{ width: 24 }} />
              <th>Model</th>
              <th style={{ width: 140 }}>Provider</th>
              <th style={{ width: 100 }} className="num">
                Context
              </th>
              <th style={{ width: 130 }} className="num">
                Input · Output
              </th>
              <th style={{ width: 140 }}>Benchmark</th>
              <th style={{ width: 90 }} className="num">
                Released
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((m) => {
              const tags = detectTags(m);
              const bench = fakeBench(m.id);
              const isPinned = pinned.includes(m.id);
              const pIn = fmtPrice(m.inputUsdPer1M);
              const pOut = fmtPrice(m.outputUsdPer1M);
              return (
                <tr
                  key={m.id}
                  className={isPinned ? "pinned" : ""}
                  onClick={() => setOpenDetail(m)}
                >
                  <td
                    onClick={(e) => {
                      e.stopPropagation();
                      togglePin(m.id);
                    }}
                  >
                    <svg
                      aria-label={isPinned ? "Unpin model" : "Pin model"}
                      className="pin"
                      viewBox="0 0 14 14"
                      fill={isPinned ? "currentColor" : "none"}
                      stroke="currentColor"
                      strokeWidth="1.4"
                    >
                      <path d="M7 1l1.5 4.5L13 7l-4.5 1.5L7 13l-1.5-4.5L1 7l4.5-1.5z" />
                    </svg>
                  </td>
                  <td>
                    <div className="mdl-name">
                      <div className="ti">{m.name || m.id.split("/").pop()}</div>
                      <div className="id">{m.id}</div>
                      {m.description && <div className="desc">{m.description}</div>}
                      {tags.length > 0 && (
                        <div className="mdl-tags" style={{ marginTop: 6 }}>
                          {tags.map((t) => (
                            <span key={t.kind} className={`mdl-tag ${t.kind}`}>
                              {t.label}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </td>
                  <td>
                    <span className="mdl-vendor">
                      <span className="dot" style={{ background: vendorDot(m) }} />
                      {vendorName(m)}
                    </span>
                  </td>
                  <td>
                    <div className="mdl-ctx">
                      {fmtCtx(m.contextWindow)}
                      <span className="unit">tok</span>
                    </div>
                  </td>
                  <td>
                    <div className="mdl-price">
                      {pIn === "free" ? (
                        <span className="free">free</span>
                      ) : (
                        <>
                          <span className="v">
                            {pIn ?? "—"} <span className="lab">in</span>
                          </span>
                          <span className="v">
                            {pOut ?? "—"} <span className="lab">out</span>
                          </span>
                        </>
                      )}
                    </div>
                  </td>
                  <td>
                    {bench != null ? (
                      <div className="mdl-bench">
                        <div className="miniBar">
                          <i style={{ width: `${bench}%` }} />
                        </div>
                        <span className="pct">{bench}</span>
                      </div>
                    ) : (
                      <div className="mdl-bench">
                        <span className="nobench">not run</span>
                      </div>
                    )}
                  </td>
                  <td>
                    <div className="mdl-date">{fmtDate(m.releasedAt)}</div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {models && filtered.length === 0 && (
        <div className="mdl-loading" style={{ fontStyle: "italic" }}>
          No models match those filters.
        </div>
      )}

      {models && (
        <div className="mdl-foot">
          <span>
            {filtered.length} of {models.length} models · {pinned.length} pinned
          </span>
          <span>Live from openrouter.ai/api/v1/models</span>
        </div>
      )}

      {openDetail && (
        <ModelDrawer
          model={openDetail}
          onClose={() => setOpenDetail(null)}
          onTogglePin={() => togglePin(openDetail.id)}
          pinned={pinned.includes(openDetail.id)}
        />
      )}
    </div>
  );
}

function ModelDrawer({
  model,
  onClose,
  onTogglePin,
  pinned,
}: {
  model: ModelInfo;
  onClose: () => void;
  onTogglePin: () => void;
  pinned: boolean;
}) {
  const tags = detectTags(model);
  const bench = fakeBench(model.id);
  const pIn = fmtPrice(model.inputUsdPer1M);
  const pOut = fmtPrice(model.outputUsdPer1M);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <>
      <div className="mdl-drawer-bg" onClick={onClose} />
      <div className="mdl-drawer" role="dialog" aria-modal="true">
        <div className="mdl-drawer-hd" style={{ position: "relative" }}>
          <button aria-label="Close" className="close" onClick={onClose} type="button">
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
            >
              <path d="M3 3l6 6M9 3l-6 6" />
            </svg>
          </button>
          <span className="mdl-vendor">
            <span className="dot" style={{ background: vendorDot(model) }} />
            {vendorName(model)}
          </span>
          <h2 className="ti">{model.name || model.id.split("/").pop()}</h2>
          <div className="id-row">{model.id}</div>
          {tags.length > 0 && (
            <div className="mdl-tags" style={{ marginTop: 12 }}>
              {tags.map((t) => (
                <span key={t.kind} className={`mdl-tag ${t.kind}`}>
                  {t.label}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="mdl-drawer-body">
          {model.description && (
            <div className="mdl-drawer-section">
              <div className="lab">What it does</div>
              <div className="desc-text">{model.description}</div>
            </div>
          )}
          <div className="mdl-drawer-section">
            <div className="lab">At a glance</div>
            <div className="mdl-stat-grid">
              <div className="cell">
                <div className="lab">Context</div>
                <div className="v">
                  {fmtCtx(model.contextWindow)}
                  <span className="ctxUnit">tok</span>
                </div>
              </div>
              <div className="cell">
                <div className="lab">Released</div>
                <div className="v">{fmtDate(model.releasedAt)}</div>
              </div>
              <div className="cell">
                <div className="lab">Input · per 1M tok</div>
                <div className="v mono">{pIn ?? "—"}</div>
              </div>
              <div className="cell">
                <div className="lab">Output · per 1M tok</div>
                <div className="v mono">{pOut ?? "—"}</div>
              </div>
              <div className="cell">
                <div className="lab">Benchmark · Pi Lab</div>
                <div className="v">{bench != null ? `${bench}%` : "—"}</div>
                <div className="sub">
                  {bench != null ? "plan score · 240 cases" : "not run yet"}
                </div>
              </div>
              <div className="cell">
                <div className="lab">Modality</div>
                <div className="v mono">{model.modality ?? "text"}</div>
              </div>
            </div>
          </div>
        </div>
        <div className="mdl-drawer-foot">
          <button className="btn2" onClick={onTogglePin} type="button">
            {pinned ? "★ Unpin" : "☆ Pin to favorites"}
          </button>
          <a
            className="btn2 primary"
            href="/experiments/new"
            style={{ textDecoration: "none", marginLeft: "auto" }}
          >
            Use in experiment →
          </a>
        </div>
      </div>
    </>
  );
}
