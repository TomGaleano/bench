"use client";

import { useEffect, useMemo, useState } from "react";
import type { ModelInfo } from "../../lib/api";

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

const PINNED_STORAGE_KEY = "pilab.playgroundPinnedModels";

function vendor(model: ModelInfo) {
  const slug = model.id.split("/")[0] || model.provider;
  return slug || "—";
}

function vendorDot(model: ModelInfo) {
  return VENDOR_DOT[vendor(model)] ?? "#888";
}

type ModelPickerProps = {
  models: ModelInfo[];
  selectedModels: Set<string>;
  onToggle: (id: string) => void;
  minSelection?: number;
  maxSelection?: number;
};

export function ModelPicker({ models, selectedModels, onToggle, minSelection = 2, maxSelection = 5 }: ModelPickerProps) {
  const [search, setSearch] = useState("");
  const [pinned, setPinned] = useState<string[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(PINNED_STORAGE_KEY);
      if (raw) setPinned(JSON.parse(raw));
    } catch {
      /* ignore */
    }
  }, []);

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

  const filteredModels = useMemo(() => {
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

  return (
    <section className="card2">
      <div className="card2-hd">
        <span className="card2-ti">Models</span>
        <span style={{ color: "var(--ink-4)", fontFamily: "var(--mono)", fontSize: 11 }}>
          {selectedModels.size} of {models.length} selected
          {pinned.length > 0 && <> · {pinned.length} pinned</>}
        </span>
      </div>

      <div className="mdl-filters" style={{ position: "static", border: "none", padding: 0, marginTop: 0 }}>
        <div className="search" style={{ minWidth: 0, flex: 1 }}>
          <svg aria-hidden="true" width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="5.5" cy="5.5" r="3.5" />
            <path d="M8.5 8.5L11 11" />
          </svg>
          <input
            aria-label="Search models"
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter models…"
            value={search}
          />
        </div>
      </div>

      {models.length === 0 ? (
        <div className="mdl-loading">
          <span className="pulse" />
          Loading models…
        </div>
      ) : (
        <ul className="exp-model-list">
          {filteredModels.slice(0, 60).map((m) => {
            const on = selectedModels.has(m.id);
            const disabled = !on && atMax;
            const isPinned = pinned.includes(m.id);
            return (
              <li key={m.id}>
                <button
                  aria-pressed={on}
                  className={"exp-model-row" + (on ? " on" : "") + (disabled ? " dim" : "")}
                  disabled={disabled}
                  onClick={() => onToggle(m.id)}
                  type="button"
                >
                  <span className="check">
                    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M2 6.5L5 9.5L10 3.5" />
                    </svg>
                  </span>
                  <span className="ti">
                    <span className="name">{m.name}</span>
                    <span className="id">{m.id}</span>
                  </span>
                  <span className="vendor">
                    <span className="dot" style={{ background: vendorDot(m) }} />
                    {vendor(m)}
                  </span>
                  <span className="ctx">
                    {m.contextWindow ? `${Math.round(m.contextWindow / 1000)}k` : "—"}
                  </span>
                  <span className="price">
                    {m.inputUsdPer1M != null ? `$${m.inputUsdPer1M.toFixed(2)}` : "—"}
                    <small> in</small>
                  </span>
                  <span
                    role="button"
                    aria-label={isPinned ? "Unpin model" : "Pin model"}
                    title={isPinned ? "Unpin" : "Pin to top"}
                    onClick={(ev) => togglePin(m.id, ev)}
                    style={{
                      color: isPinned ? "#f59e0b" : "var(--ink-4)",
                      cursor: "pointer",
                      padding: "0 4px",
                      fontSize: 14,
                      lineHeight: 1,
                    }}
                  >
                    {isPinned ? "★" : "☆"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div style={{ marginTop: 8, fontSize: 12, color: "var(--ink-4)" }}>
        {selectedModels.size < minSelection
          ? `Select at least ${minSelection} models`
          : `Selected ${selectedModels.size} model${selectedModels.size > 1 ? "s" : ""}`}
      </div>
    </section>
  );
}
