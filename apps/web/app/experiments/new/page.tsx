"use client";

import { useEffect, useMemo, useState } from "react";
import { Hero } from "../../../components/ui/Hero";
import { SectionHeader } from "../../../components/ui/SectionHeader";
import { createPiPlanRun, listModels, type ModelInfo, type RunSummary } from "../../../lib/api";
import { tasks } from "../../../lib/data";
import { formatCurrency } from "../../../lib/format";

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

function vendor(model: ModelInfo) {
  const slug = model.id.split("/")[0] || model.provider;
  return slug || "—";
}

function vendorDot(model: ModelInfo) {
  return VENDOR_DOT[vendor(model)] ?? "#888";
}

type PreflightCheck = {
  key: string;
  label: string;
  detail: string;
  status: "ok" | "warn" | "fail";
};

export default function ExperimentSetupPage() {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set());
  const [selectedTasks, setSelectedTasks] = useState<Set<string>>(
    () => new Set(tasks.slice(0, 8).map((task) => task.id)),
  );
  const [caseVersionId, setCaseVersionId] = useState("");
  const [harness, setHarness] = useState("pi-react/1.4");
  const [launchStatus, setLaunchStatus] = useState<"idle" | "launching" | "launched" | "failed">("idle");
  const [launchError, setLaunchError] = useState("");
  const [launchedRun, setLaunchedRun] = useState<RunSummary | null>(null);
  const [search, setSearch] = useState("");

  const totalRuns = selectedModels.size * Math.max(1, selectedTasks.size);
  const estimatedCost = useMemo(() => totalRuns * 0.31, [totalRuns]);

  useEffect(() => {
    listModels()
      .then((data) => {
        setModels(data);
        setSelectedModels(new Set(data.slice(0, 5).map((m) => m.id)));
        setModelsLoading(false);
      })
      .catch(() => setModelsLoading(false));
  }, []);

  function toggle(
    setter: React.Dispatch<React.SetStateAction<Set<string>>>,
    id: string,
  ) {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const filteredModels = useMemo(() => {
    if (!search.trim()) return models;
    const q = search.trim().toLowerCase();
    return models.filter(
      (m) =>
        m.id.toLowerCase().includes(q) ||
        m.name.toLowerCase().includes(q) ||
        m.provider.toLowerCase().includes(q),
    );
  }, [models, search]);

  const preflight = useMemo<PreflightCheck[]>(() => {
    const checks: PreflightCheck[] = [];
    checks.push(
      selectedModels.size === 0
        ? { key: "models", label: "Models", status: "fail", detail: "Select at least one model." }
        : { key: "models", label: "Models", status: "ok", detail: `${selectedModels.size} selected` },
    );
    checks.push(
      caseVersionId.trim().length === 36
        ? { key: "case", label: "Case version", status: "ok", detail: "UUID looks valid." }
        : caseVersionId.trim().length === 0
          ? { key: "case", label: "Case version", status: "warn", detail: "Paste a frozen case version ID." }
          : { key: "case", label: "Case version", status: "fail", detail: "Expected a 36-char UUID." },
    );
    checks.push({
      key: "harness",
      label: "Harness",
      status: "ok",
      detail: harness,
    });
    checks.push({
      key: "budget",
      label: "Budget cap",
      status: "warn",
      detail: "No cap set — runs will execute without a spend ceiling.",
    });
    return checks;
  }, [selectedModels, caseVersionId, harness]);

  const canLaunch =
    preflight.every((c) => c.status !== "fail") && launchStatus !== "launching";

  async function launchPiPlanRun() {
    const modelId = selectedModels.values().next().value as string | undefined;
    if (!caseVersionId.trim() || !modelId) {
      setLaunchStatus("failed");
      setLaunchError("Enter a case version ID and select at least one model.");
      return;
    }

    setLaunchStatus("launching");
    setLaunchError("");

    try {
      const run = await createPiPlanRun({
        caseVersionId: caseVersionId.trim(),
        modelId,
        maxTurns: 8,
        maxWallClockSeconds: 300,
      });
      setLaunchedRun(run);
      setLaunchStatus("launched");
      window.location.href = `/runs?runId=${run.id}`;
    } catch (err) {
      setLaunchStatus("failed");
      setLaunchError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="mdl-page exp-page">
      <Hero
        eyebrow="Experiments"
        title={
          <>
            <em>Compose</em> an experiment.
          </>
        }
        lede="Toggle models and tasks to shape the run matrix. Each selected cell maps to one future run; pre-flight checks gate the launch."
        meta={[
          ["Runs", String(totalRuns)],
          ["Estimate", formatCurrency(estimatedCost)],
          ["Harness", harness],
        ]}
      />

      <div className="exp-split">
        <section className="exp-models card2">
          <div className="card2-hd">
            <span className="card2-ti">Models</span>
            <span style={{ color: "var(--ink-4)", fontFamily: "var(--mono)", fontSize: 11 }}>
              {selectedModels.size} of {models.length}
            </span>
          </div>
          <div className="mdl-filters" style={{ position: "static", border: "none", padding: 0, marginTop: 0 }}>
            <div className="search" style={{ minWidth: 0, flex: 1 }}>
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
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter models…"
                value={search}
              />
            </div>
          </div>

          {modelsLoading ? (
            <div className="mdl-loading">
              <span className="pulse" />
              Loading models…
            </div>
          ) : (
            <ul className="exp-model-list">
              {filteredModels.slice(0, 60).map((m) => {
                const on = selectedModels.has(m.id);
                return (
                  <li key={m.id}>
                    <button
                      aria-pressed={on}
                      className={"exp-model-row" + (on ? " on" : "")}
                      onClick={() => toggle(setSelectedModels, m.id)}
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
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <aside className="exp-side">
          <section className="card2">
            <div className="card2-hd">
              <span className="card2-ti">Harness</span>
            </div>
            <div className="exp-harness">
              {["pi-react/1.4", "pi-plan/2.0", "swe-bench-lite"].map((h) => (
                <button
                  key={h}
                  className={"exp-radio" + (harness === h ? " on" : "")}
                  onClick={() => setHarness(h)}
                  type="button"
                >
                  <span className="rdot" />
                  <span>{h}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="card2">
            <div className="card2-hd">
              <span className="card2-ti">Preflight</span>
            </div>
            <ul className="exp-preflight">
              {preflight.map((c) => (
                <li key={c.key} className={`pf-${c.status}`}>
                  <span className="pip" />
                  <div className="pf-text">
                    <strong>{c.label}</strong>
                    <small>{c.detail}</small>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section className="card2">
            <div className="card2-hd">
              <span className="card2-ti">Run matrix</span>
              <span style={{ color: "var(--ink-4)", fontFamily: "var(--mono)", fontSize: 11 }}>
                {totalRuns} cells
              </span>
            </div>
            {tasks.length === 0 ? (
              <p style={{ color: "var(--ink-4)", fontFamily: "var(--serif)", fontStyle: "italic" }}>
                No tasks loaded — runs will use the case version below.
              </p>
            ) : (
              <div className="exp-matrix">
                <div />
                {tasks.slice(0, 8).map((_t, i) => (
                  <b key={i}>{i + 1}</b>
                ))}
                {models
                  .filter((m) => selectedModels.has(m.id))
                  .slice(0, 8)
                  .map((m) => (
                    <div className="exp-matrix-row" key={m.id}>
                      <span>{m.name}</span>
                      {tasks.slice(0, 8).map((t) => (
                        <button
                          key={t.id}
                          aria-label={`${m.id} × ${t.id}`}
                          className={selectedTasks.has(t.id) ? "on" : ""}
                          onClick={() => toggle(setSelectedTasks, t.id)}
                          type="button"
                        />
                      ))}
                    </div>
                  ))}
              </div>
            )}
          </section>

          <section className="card2">
            <div className="card2-hd">
              <span className="card2-ti">Launch</span>
            </div>
            <label className="exp-field">
              <span>Case version ID</span>
              <input
                onChange={(e) => setCaseVersionId(e.target.value)}
                placeholder="00000000-0000-0000-0000-000000000000"
                value={caseVersionId}
              />
            </label>
            <button
              className="btn2 primary"
              disabled={!canLaunch}
              onClick={launchPiPlanRun}
              style={{ marginTop: 12, width: "100%" }}
              type="button"
            >
              {launchStatus === "launching" ? "Launching…" : "Launch experiment →"}
            </button>
            {launchStatus === "launched" && launchedRun && (
              <p className="exp-msg ok">Queued plan run {launchedRun.id.slice(0, 8)}…</p>
            )}
            {launchStatus === "failed" && <p className="exp-msg fail">{launchError}</p>}
          </section>
        </aside>
      </div>

      <SectionHeader num="02">
        How the <em>matrix</em> renders
      </SectionHeader>
      <p className="section-sub">
        Each cell is one run. Empty cells will be skipped. The preflight checklist must clear before
        you can launch.
      </p>
    </div>
  );
}
