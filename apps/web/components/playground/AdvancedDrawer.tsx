"use client";

import { useState } from "react";

export type PlaygroundAdvancedOptions = {
  maxWallClockSeconds: number;
  maxOutputTokensPerAgent: number;
  tools: string[];
  sandboxImage: "py" | "node" | "py-node" | "custom";
  seedPromptText: string;
  runTwiceAndAverage: boolean;
};

export const PLAYGROUND_ADVANCED_DEFAULTS: PlaygroundAdvancedOptions = {
  maxWallClockSeconds: 600,
  maxOutputTokensPerAgent: 32_000,
  tools: ["read", "write", "edit", "grep", "find", "ls", "bash"],
  sandboxImage: "py-node",
  seedPromptText: "",
  runTwiceAndAverage: false,
};

const ALL_TOOLS: Array<{ id: string; label: string }> = [
  { id: "bash", label: "bash" },
  { id: "read", label: "read" },
  { id: "write", label: "write" },
  { id: "edit", label: "edit" },
  { id: "grep", label: "grep" },
  { id: "network", label: "network" },
];

type AdvancedDrawerProps = {
  value: PlaygroundAdvancedOptions;
  onChange: (next: PlaygroundAdvancedOptions) => void;
};

export function AdvancedDrawer({ value, onChange }: AdvancedDrawerProps) {
  const [open, setOpen] = useState(false);

  function setField<K extends keyof PlaygroundAdvancedOptions>(
    key: K,
    next: PlaygroundAdvancedOptions[K],
  ) {
    onChange({ ...value, [key]: next });
  }

  function toggleTool(id: string) {
    const next = value.tools.includes(id)
      ? value.tools.filter((t) => t !== id)
      : [...value.tools, id];
    setField("tools", next);
  }

  const wallMinutes = Math.round(value.maxWallClockSeconds / 60);
  const outputKilos = Math.round(value.maxOutputTokensPerAgent / 1000);
  const changedCount = countChanges(value);

  return (
    <div className={"pg-card" + (open ? " expanded" : "")}>
      <div className="pg-adv-hd" onClick={() => setOpen((v) => !v)} role="button" tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((v) => !v);
          }
        }}
      >
        <div className="ti">Advanced options</div>
        <span style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--ink-4)" }}>
          {open ? "—" : changedCount > 0 ? `${changedCount} edited` : "defaults"}
          <span className="caret" style={{ display: "inline-block", marginLeft: 6 }}>
            <svg
              viewBox="0 0 14 14"
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
            >
              <path d="M5 3l4 4-4 4" />
            </svg>
          </span>
        </span>
      </div>
      {open && (
        <div className="pg-adv-bd">
          <div className="pg-field">
            <div className="lab">
              <span>Wall-clock cap</span>
              <span className="v">{wallMinutes} min</span>
            </div>
            <input
              type="range"
              min={1}
              max={30}
              value={wallMinutes}
              onChange={(e) => setField("maxWallClockSeconds", Number(e.target.value) * 60)}
            />
          </div>

          <div className="pg-field">
            <div className="lab">
              <span>Per-agent output cap</span>
              <span className="v">{outputKilos}k tok</span>
            </div>
            <input
              type="range"
              min={4}
              max={128}
              step={4}
              value={outputKilos}
              onChange={(e) => setField("maxOutputTokensPerAgent", Number(e.target.value) * 1000)}
            />
          </div>

          <div className="pg-field">
            <div className="lab">Tool allowlist</div>
            <div className="pg-toolgrid">
              {ALL_TOOLS.map((t) => {
                const on = value.tools.includes(t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    className={"pg-toolchip" + (on ? " on" : "")}
                    onClick={() => toggleTool(t.id)}
                  >
                    <span className="pip" />
                    {t.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="pg-field">
            <div className="lab">Sandbox base image</div>
            <select
              value={value.sandboxImage}
              onChange={(e) =>
                setField(
                  "sandboxImage",
                  e.target.value as PlaygroundAdvancedOptions["sandboxImage"],
                )
              }
            >
              <option value="py">Python 3.12 · ubuntu 24.04</option>
              <option value="node">Node 22 · ubuntu 24.04</option>
              <option value="py-node">Python + Node · ubuntu 24.04</option>
              <option value="custom" disabled>
                Custom Dockerfile — coming soon
              </option>
            </select>
          </div>

          <div className="pg-field">
            <div className="lab">
              <span>Seed prompt</span>
              <span style={{ color: "var(--ink-4)", textTransform: "none", letterSpacing: 0 }}>
                optional
              </span>
            </div>
            <textarea
              value={value.seedPromptText}
              onChange={(e) => setField("seedPromptText", e.target.value)}
              placeholder="Drop a starter README, schema, or constraints here. Each agent gets it as SEED.md in their worktree."
              rows={3}
              style={{
                border: "1px solid var(--rule-2)",
                borderRadius: 6,
                padding: "8px 10px",
                fontFamily: "var(--mono)",
                fontSize: 11.5,
                resize: "vertical",
                color: "var(--ink-2)",
                background: "var(--paper)",
                outline: "none",
              }}
            />
          </div>

          <div className="pg-field">
            <div
              className="lab"
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
            >
              <span>Run each agent twice & average</span>
              <button
                type="button"
                aria-pressed={value.runTwiceAndAverage}
                onClick={() => setField("runTwiceAndAverage", !value.runTwiceAndAverage)}
                style={{
                  display: "inline-block",
                  width: 30,
                  height: 18,
                  borderRadius: 999,
                  background: value.runTwiceAndAverage ? "var(--ink)" : "var(--rule-3)",
                  position: "relative",
                  border: "none",
                  cursor: "pointer",
                  padding: 0,
                  transition: "background 140ms ease",
                }}
              >
                <span
                  style={{
                    position: "absolute",
                    top: 2,
                    left: value.runTwiceAndAverage ? 14 : 2,
                    width: 14,
                    height: 14,
                    borderRadius: "50%",
                    background: "var(--paper)",
                    transition: "left 180ms ease",
                  }}
                />
              </button>
            </div>
            <div
              style={{
                fontFamily: "var(--mono)",
                fontSize: 10.5,
                color: "var(--ink-4)",
                lineHeight: 1.5,
              }}
            >
              Doubles cost. Reveals per-model variance — useful for benchmark publication.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function countChanges(opts: PlaygroundAdvancedOptions): number {
  const d = PLAYGROUND_ADVANCED_DEFAULTS;
  let n = 0;
  if (opts.maxWallClockSeconds !== d.maxWallClockSeconds) n++;
  if (opts.maxOutputTokensPerAgent !== d.maxOutputTokensPerAgent) n++;
  if (opts.tools.length !== d.tools.length || opts.tools.some((t) => !d.tools.includes(t))) n++;
  if (opts.sandboxImage !== d.sandboxImage) n++;
  if (opts.seedPromptText.trim().length > 0) n++;
  if (opts.runTwiceAndAverage !== d.runTwiceAndAverage) n++;
  return n;
}
