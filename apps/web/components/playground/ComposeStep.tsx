"use client";

import { useMemo } from "react";
import type { ModelInfo } from "../../lib/api";
import { ModelPicker } from "./ModelPicker";
import {
  AdvancedDrawer,
  type PlaygroundAdvancedOptions,
} from "./AdvancedDrawer";
import { StepRail } from "./StepRail";
import { PLAYGROUND_TEMPLATES } from "../../lib/playground-templates";
import { pgVendor } from "../../lib/playground-vendor";
import { estimateSessionCost, formatUsd } from "../../lib/playground-cost";

const TASK_MAX_CHARS = 4000;
const TASK_MIN_CHARS = 10;

type ComposeStepProps = {
  models: ModelInfo[];
  prompt: string;
  onPromptChange: (next: string) => void;
  selectedModels: Set<string>;
  onToggleModel: (id: string) => void;
  onApplyPreset: (modelIds: string[]) => void;
  onRemoveSelected: (id: string) => void;
  graderModelId: string;
  onGraderModelIdChange: (next: string) => void;
  advanced: PlaygroundAdvancedOptions;
  onAdvancedChange: (next: PlaygroundAdvancedOptions) => void;
  canLaunch: boolean;
  launching: boolean;
  onLaunch: () => void;
  minSelection?: number;
  maxSelection?: number;
};

export function ComposeStep(props: ComposeStepProps) {
  const {
    models,
    prompt,
    onPromptChange,
    selectedModels,
    onToggleModel,
    onApplyPreset,
    onRemoveSelected,
    graderModelId,
    onGraderModelIdChange,
    advanced,
    onAdvancedChange,
    canLaunch,
    launching,
    onLaunch,
    minSelection = 2,
    maxSelection = 5,
  } = props;

  const chars = prompt.length;
  const trimmedLength = prompt.trim().length;

  const selectedModelInfos = useMemo(() => {
    return Array.from(selectedModels)
      .map((id) => models.find((m) => m.id === id))
      .filter((m): m is ModelInfo => Boolean(m));
  }, [models, selectedModels]);

  const graderModel = useMemo(
    () => models.find((m) => m.id === graderModelId.trim()) ?? null,
    [models, graderModelId],
  );

  const cost = useMemo(() => {
    if (selectedModelInfos.length === 0) return null;
    return estimateSessionCost({
      selectedModels: selectedModelInfos,
      maxWallClockSeconds: advanced.maxWallClockSeconds,
      expectedOutputTokensPerAgent: advanced.maxOutputTokensPerAgent,
      autograderModel: graderModel,
      runTwiceAndAverage: advanced.runTwiceAndAverage,
    });
  }, [selectedModelInfos, advanced, graderModel]);

  const preflightChecks = [
    {
      key: "task",
      label: "Task length ≥ 10 chars",
      ok: trimmedLength >= TASK_MIN_CHARS,
      value: `${trimmedLength}${trimmedLength >= TASK_MIN_CHARS ? " ✓" : ""}`,
    },
    {
      key: "min-models",
      label: `At least ${minSelection} models`,
      ok: selectedModels.size >= minSelection,
      value: `${selectedModels.size}${selectedModels.size >= minSelection ? " ✓" : ""}`,
    },
    {
      key: "max-models",
      label: `At most ${maxSelection} models`,
      ok: selectedModels.size <= maxSelection,
      value: `${selectedModels.size}${selectedModels.size <= maxSelection ? " ✓" : ""}`,
    },
  ] as const;
  const okCount = preflightChecks.filter((c) => c.ok).length;

  function applyTemplate(prompt: string) {
    onPromptChange(prompt);
  }

  return (
    <div className="pg-page">
      <StepRail current="compose" />

      <div className="pg-split">
        <div className="pg-col">
          {/* TASK CARD */}
          <section className="pg-card pg-task">
            <div className="pg-card-hd">
              <div className="ti">
                <span className="num">i.</span>Task prompt
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <span className="tag2">markdown supported</span>
                <span className="tag2">⌘↵ to launch</span>
              </div>
            </div>
            <textarea
              value={prompt}
              onChange={(e) => onPromptChange(e.target.value.slice(0, TASK_MAX_CHARS))}
              placeholder='Build a Flask web app that lets users track LeetCode problems they have solved…'
              rows={5}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canLaunch && !launching) {
                  e.preventDefault();
                  onLaunch();
                }
              }}
            />
            <div className="pg-card-ft">
              <span className="counter">
                <b>{chars}</b> / {TASK_MAX_CHARS} chars · ~{Math.round(chars / 4)} tok
              </span>
              <span>min {TASK_MIN_CHARS} chars · models receive identical prompt</span>
            </div>
            <div className="pg-templates">
              {PLAYGROUND_TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className="pg-template"
                  onClick={() => applyTemplate(t.prompt)}
                >
                  <span className="meta">{t.meta}</span>
                  <span className="nm">{t.name}</span>
                </button>
              ))}
            </div>
          </section>

          <ModelPicker
            models={models}
            selectedModels={selectedModels}
            onToggle={onToggleModel}
            onApplyPreset={onApplyPreset}
            minSelection={minSelection}
            maxSelection={maxSelection}
          />
        </div>

        {/* RIGHT SIDEBAR */}
        <div className="pg-col">
          <section className="pg-card">
            <div className="pg-card-hd">
              <div className="ti">Selected agents</div>
              <span className="tag2">
                {selectedModels.size} of {maxSelection}
              </span>
            </div>
            <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
              {selectedModelInfos.length > 0 ? (
                selectedModelInfos.map((m, idx) => (
                  <div key={m.id} className="pg-selected-chip">
                    <span
                      className="pg-vendor-dot"
                      style={{ background: pgVendor(m.id), width: 8, height: 8 }}
                    />
                    <span>
                      <span className="nm">{m.name}</span>
                      <span className="id"> · port {30000 + idx}</span>
                    </span>
                    <button
                      type="button"
                      className="x"
                      aria-label={`Remove ${m.name}`}
                      onClick={() => onRemoveSelected(m.id)}
                      style={{ background: "transparent", border: "none", padding: 0 }}
                    >
                      <svg
                        viewBox="0 0 12 12"
                        width="10"
                        height="10"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.6"
                      >
                        <path d="M3 3l6 6M9 3l-6 6" />
                      </svg>
                    </button>
                  </div>
                ))
              ) : (
                <div className="pg-selected-empty">Pick at least {minSelection} models.</div>
              )}
              {selectedModelInfos.length > 0 && selectedModelInfos.length < maxSelection && (
                <div
                  className="pg-selected-empty"
                  style={{ padding: "10px", fontSize: 12 }}
                >
                  + add up to {maxSelection - selectedModelInfos.length} more
                </div>
              )}
            </div>
          </section>

          {/* COST + TIME ESTIMATOR */}
          {cost && (
            <section className="pg-card pg-cost">
              <div className="lab">Estimated session</div>
              <div className="big">
                <em>{formatUsd(cost.mid)}</em> · {cost.wallMinutes} min
              </div>
              <div className="sub">
                {selectedModelInfos.length} agents · {cost.wallMinutes} min cap · ~
                {Math.round(cost.outputTokensPerAgent / 1000)}k output tok each
                {advanced.runTwiceAndAverage ? " · 2× runs" : ""}
              </div>
              <div className="breakdown">
                <span>Sandbox time</span>
                <span className="v">{formatUsd(cost.sandboxUsd)}</span>
                <span>
                  Model output ({selectedModelInfos.length} × ~
                  {Math.round(cost.outputTokensPerAgent / 1000)}k tok)
                </span>
                <span className="v">{formatUsd(cost.modelOutputUsd)}</span>
                <span>Autograder{graderModel ? ` · ${graderModel.name}` : ""}</span>
                <span className="v">{formatUsd(cost.autograderUsd)}</span>
                <span style={{ color: "var(--ink-4)" }}>Worst-case ceiling</span>
                <span className="v" style={{ color: "var(--ink-3)" }}>
                  {formatUsd(cost.worstCase)}
                </span>
              </div>
            </section>
          )}

          {/* PREFLIGHT */}
          <section className="pg-card">
            <div className="pg-card-hd">
              <div className="ti">Preflight</div>
              <span
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 10.5,
                  color: okCount === preflightChecks.length ? "var(--ok)" : "var(--ink-4)",
                }}
              >
                ● {okCount} of {preflightChecks.length}
              </span>
            </div>
            <div className="pg-preflight">
              {preflightChecks.map((c) => (
                <div key={c.key} className="item">
                  <span className={"pip " + (c.ok ? "ok" : "err")} />
                  <span>{c.label}</span>
                  <span className="v">{c.value}</span>
                </div>
              ))}
            </div>
          </section>

          {/* AUTOGRADER */}
          <section className="pg-card">
            <div className="pg-card-hd">
              <div className="ti">Autograder</div>
              <span style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--ink-4)" }}>
                optional
              </span>
            </div>
            <div style={{ padding: "12px 18px 16px" }}>
              <label
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                  fontFamily: "var(--mono)",
                  fontSize: 10,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  color: "var(--ink-4)",
                }}
              >
                <span>Grader model ID</span>
                <input
                  value={graderModelId}
                  onChange={(e) => onGraderModelIdChange(e.target.value)}
                  placeholder="anthropic/claude-haiku-4"
                  style={{
                    fontFamily: "var(--mono)",
                    fontSize: 12.5,
                    padding: "7px 10px",
                    border: "1px solid var(--rule-2)",
                    borderRadius: 6,
                    color: "var(--ink)",
                    background: "var(--paper)",
                    outline: "none",
                  }}
                />
              </label>
            </div>
          </section>

          {/* ADVANCED */}
          <AdvancedDrawer value={advanced} onChange={onAdvancedChange} />

          {/* LAUNCH */}
          <section className="pg-card pg-launch">
            <button
              type="button"
              disabled={!canLaunch || launching}
              onClick={onLaunch}
            >
              {launching ? "Launching…" : "Launch playground"}
              <span className="kbd">⌘↵</span>
            </button>
            <div className="caption">
              Each agent gets its own worktree + port 30000+ inside a shared E2B sandbox
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
