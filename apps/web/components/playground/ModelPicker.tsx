"use client";

import { useEffect, useMemo, useState } from "react";
import type { ModelInfo } from "../../lib/api";
import { pgVendor } from "../../lib/playground-vendor";
import { PLAYGROUND_PRESETS } from "../../lib/playground-presets";

const PINNED_STORAGE_KEY = "pilab.playgroundPinnedModels";
const TAB_STORAGE_KEY = "pilab.playgroundPickerTab";

type Tab = "browse" | "recommended" | "pinned";

type ModelPickerProps = {
  models: ModelInfo[];
  selectedModels: Set<string>;
  onToggle: (id: string) => void;
  onApplyPreset?: (modelIds: string[]) => void;
  minSelection?: number;
  maxSelection?: number;
};

function modelTags(m: ModelInfo): string[] {
  const tags: string[] = [];
  if (m.supportsToolCalling) tags.push("tool");
  if (m.modality && /vision|image/i.test(m.modality)) tags.push("vision");
  if (/opus|o1|o3|reasoning|sonnet-4|thinking/i.test(`${m.id} ${m.name}`)) tags.push("reason");
  return tags;
}

function fmtCtx(n: number | undefined): string {
  if (!n) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

function fmtPrice(n: number | undefined): string {
  if (n == null) return "—";
  return `$${n.toFixed(2)}`;
}

function vendorSlug(m: ModelInfo): string {
  return m.id.split("/")[0] || m.provider;
}

export function ModelPicker({
  models,
  selectedModels,
  onToggle,
  onApplyPreset,
  minSelection = 2,
  maxSelection = 5,
}: ModelPickerProps) {
  const [tab, setTab] = useState<Tab>("browse");
  const [search, setSearch] = useState("");
  const [pinned, setPinned] = useState<string[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(PINNED_STORAGE_KEY);
      if (raw) setPinned(JSON.parse(raw));
    } catch {
      /* ignore */
    }
    try {
      const raw = localStorage.getItem(TAB_STORAGE_KEY);
      if (raw === "browse" || raw === "recommended" || raw === "pinned") {
        setTab(raw);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(TAB_STORAGE_KEY, tab);
    } catch {
      /* ignore */
    }
  }, [tab]);

  function togglePin(id: string, ev: React.MouseEvent) {
    ev.stopPropagation();
    setPinned((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      try {
        localStorage.setItem(PINNED_STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  const atMax = selectedModels.size >= maxSelection;

  const browseModels = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = q
      ? models.filter(
          (m) =>
            m.id.toLowerCase().includes(q) ||
            m.name.toLowerCase().includes(q) ||
            m.provider.toLowerCase().includes(q),
        )
      : models.slice();
    base.sort((a, b) => {
      const ap = pinned.includes(a.id);
      const bp = pinned.includes(b.id);
      if (ap !== bp) return ap ? -1 : 1;
      return 0;
    });
    return base;
  }, [models, search, pinned]);

  const pinnedModels = useMemo(
    () => models.filter((m) => pinned.includes(m.id)),
    [models, pinned],
  );

  const visibleModels = tab === "pinned" ? pinnedModels : browseModels;

  return (
    <section className="pg-card pg-models">
      <div className="pg-card-hd">
        <div className="ti">
          <span className="num">ii.</span>Model overview
        </div>
        <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-3)" }}>
          <b style={{ color: "var(--ink)", fontWeight: 500 }}>{selectedModels.size}</b>
          <span style={{ color: "var(--ink-4)" }}>
            {" "}/ {maxSelection} selected · max {maxSelection} per session
          </span>
        </div>
      </div>

      <div className="pg-tabs">
        <button
          type="button"
          className={"pg-tab" + (tab === "browse" ? " on" : "")}
          onClick={() => setTab("browse")}
        >
          Browse<span className="ct">{models.length}</span>
        </button>
        <button
          type="button"
          className={"pg-tab" + (tab === "recommended" ? " on" : "")}
          onClick={() => setTab("recommended")}
        >
          Recommended<span className="ct">{PLAYGROUND_PRESETS.length} presets</span>
        </button>
        <button
          type="button"
          className={"pg-tab" + (tab === "pinned" ? " on" : "")}
          onClick={() => setTab("pinned")}
        >
          Pinned<span className="ct">{pinned.length}</span>
        </button>
      </div>

      {tab === "recommended" ? (
        <div>
          {PLAYGROUND_PRESETS.map((preset) => {
            const presetModels = preset.modelIds
              .map((id) => models.find((m) => m.id === id))
              .filter((m): m is ModelInfo => Boolean(m));
            return (
              <div key={preset.id} className="pg-preset">
                <div className="row">
                  <div>
                    <div className="nm">{preset.name}</div>
                    <div className="desc">{preset.description}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <button
                      type="button"
                      className="btn2"
                      disabled={presetModels.length < 2}
                      onClick={() => onApplyPreset?.(presetModels.map((m) => m.id))}
                      title={
                        presetModels.length < 2
                          ? `${preset.modelIds.length - presetModels.length} of the preset's models aren't available right now`
                          : `Load this preset (${presetModels.length} models)`
                      }
                    >
                      Load preset
                    </button>
                  </div>
                </div>
                <div className="models">
                  {presetModels.length > 0 ? (
                    presetModels.map((m) => (
                      <span key={m.id} className="chip">
                        <span
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: "50%",
                            background: pgVendor(m.id),
                          }}
                        />
                        {m.name}
                      </span>
                    ))
                  ) : (
                    <span
                      className="chip"
                      style={{
                        borderStyle: "dashed",
                        color: "var(--ink-4)",
                      }}
                    >
                      none of these models are currently available
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <>
          <div className="pg-models-search">
            <svg
              width="12"
              height="12"
              viewBox="0 0 13 13"
              fill="none"
              stroke="var(--ink-4)"
              strokeWidth="1.5"
              aria-hidden="true"
            >
              <circle cx="5.5" cy="5.5" r="3.5" />
              <path d="M8.5 8.5L11 11" />
            </svg>
            <input
              aria-label="Search models"
              placeholder={`Search ${models.length} models · provider, capability, price…`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <span className="kbd2">⌘K</span>
          </div>

          {models.length === 0 ? (
            <div className="mdl-loading" style={{ padding: 18 }}>
              <span className="pulse" />
              Loading models…
            </div>
          ) : visibleModels.length === 0 ? (
            <div
              style={{
                padding: 22,
                fontFamily: "var(--serif)",
                fontStyle: "italic",
                color: "var(--ink-4)",
              }}
            >
              {tab === "pinned"
                ? "No pinned models yet. Star a row to pin it."
                : "No models match that search."}
            </div>
          ) : (
            visibleModels.slice(0, 60).map((m) => {
              const selected = selectedModels.has(m.id);
              const dimmed = !selected && atMax;
              const isPinned = pinned.includes(m.id);
              const tags = modelTags(m);
              return (
                <div
                  key={m.id}
                  role="button"
                  tabIndex={0}
                  aria-pressed={selected}
                  className={
                    "pg-model-row" +
                    (selected ? " selected" : "") +
                    (dimmed ? " dimmed" : "")
                  }
                  onClick={() => !dimmed && onToggle(m.id)}
                  onKeyDown={(e) => {
                    if ((e.key === "Enter" || e.key === " ") && !dimmed) {
                      e.preventDefault();
                      onToggle(m.id);
                    }
                  }}
                >
                  <div className={"pg-checkbox" + (selected ? " on" : "")}>
                    <svg
                      viewBox="0 0 12 12"
                      width="10"
                      height="10"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M2.5 6.5l2.5 2.5L9.5 3.5" />
                    </svg>
                  </div>
                  <span className="pg-vendor-dot" style={{ background: pgVendor(m.id) }} />
                  <div className="pg-model-name">
                    <div className="nm">{m.name}</div>
                    <div className="id">{m.id}</div>
                    {tags.length > 0 && (
                      <div className="pg-model-tags">
                        {tags.map((t) => (
                          <span key={t} className={"pg-model-tag " + t}>
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="pg-model-meta">
                    <span className="lab">Context</span>
                    {fmtCtx(m.contextWindow)} tok
                  </div>
                  <div className="pg-model-meta">
                    <span className="lab">$ / 1M</span>
                    {fmtPrice(m.inputUsdPer1M)}
                    <span style={{ color: "var(--ink-5)" }}>
                      {" · "}
                      {fmtPrice(m.outputUsdPer1M)}
                    </span>
                  </div>
                  <div className="pg-model-meta" style={{ textAlign: "left" }}>
                    <span className="lab">Provider</span>
                    {vendorSlug(m)}
                  </div>
                  <span
                    role="button"
                    aria-label={isPinned ? "Unpin model" : "Pin model"}
                    title={isPinned ? "Unpin" : "Pin to top"}
                    onClick={(ev) => togglePin(m.id, ev)}
                    className={"pg-pin" + (isPinned ? " on" : "")}
                  >
                    <svg
                      viewBox="0 0 14 14"
                      width="14"
                      height="14"
                      fill={isPinned ? "currentColor" : "none"}
                      stroke="currentColor"
                      strokeWidth="1.4"
                    >
                      <path d="M7 1l1.5 4.5L13 7l-4.5 1.5L7 13l-1.5-4.5L1 7l4.5-1.5z" />
                    </svg>
                  </span>
                </div>
              );
            })
          )}
        </>
      )}

      <div className="pg-card-ft">
        <span>
          {tab === "recommended"
            ? `${PLAYGROUND_PRESETS.length} presets`
            : `Showing ${Math.min(visibleModels.length, 60)} of ${models.length}`}
        </span>
        <span>
          {pinned.length} pinned · {selectedModels.size} selected
        </span>
      </div>

      <div style={{ marginTop: 0, fontSize: 12, color: "var(--ink-4)", padding: "0 18px 16px" }}>
        {selectedModels.size < minSelection
          ? `Select at least ${minSelection} models`
          : `Selected ${selectedModels.size} model${selectedModels.size > 1 ? "s" : ""}`}
      </div>
    </section>
  );
}
