"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { EmptyState, SectionTitle, StatusPill } from "../../../components/ui";
import { Hero } from "../../../components/ui/Hero";
import type { DatasetSummary } from "../../../lib/api";
import { createBenchmark, getDataset, listDatasets, listModels, startBenchmark, type ModelInfo } from "../../../lib/api";

const MODES = [
  { value: "plan-only", label: "Plan only" },
  { value: "implementation-only", label: "Implementation only" },
  { value: "end-to-end", label: "End-to-end" },
] as const;

const STEPS = [
  { id: "dataset", label: "Select Dataset" },
  { id: "agent1", label: "Configure Agent 1" },
  { id: "agent2", label: "Configure Agent 2" },
  { id: "review", label: "Review & Launch" },
] as const;

export default function BenchmarkNewPage() {
  const router = useRouter();

  // Step state
  const [step, setStep] = useState<number>(0);

  // Step 1: Dataset
  const [datasets, setDatasets] = useState<DatasetSummary[]>([]);
  const [datasetsLoading, setDatasetsLoading] = useState(true);
  const [selectedDatasetSlug, setSelectedDatasetSlug] = useState("");
  const [datasetCaseCount, setDatasetCaseCount] = useState(0);

  // Step 2 & 3: Agent config
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [modelSearch, setModelSearch] = useState("");
  const [name, setName] = useState("");

  const [agent1ModelId, setAgent1ModelId] = useState("");
  const [agent1Mode, setAgent1Mode] = useState<string>("end-to-end");

  const [agent2ModelId, setAgent2ModelId] = useState("");
  const [agent2Mode, setAgent2Mode] = useState<string>("end-to-end");

  // Step 4: Launch
  const [launchStatus, setLaunchStatus] = useState<"idle" | "launching" | "starting" | "success" | "failed">("idle");
  const [launchError, setLaunchError] = useState("");
  const [error, setError] = useState("");

  // Load data
  useEffect(() => {
    Promise.all([listDatasets(), listModels()])
      .then(([ds, ms]) => {
        setDatasets(ds.filter((d) => d.status === "draft" || d.status === "ready" || d.status === "frozen"));
        setModels(ms);
        setDatasetsLoading(false);
        setModelsLoading(false);

        // Pre-fill agent models
        const firstModel = ms[0];
        const secondModel = ms[1];
        if (firstModel) {
          setAgent1ModelId(firstModel.id);
          setAgent2ModelId(secondModel ? secondModel.id : firstModel.id);
        }
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
        setDatasetsLoading(false);
        setModelsLoading(false);
      });
  }, []);

  // Load dataset detail when selected
  useEffect(() => {
    if (!selectedDatasetSlug) {
      setDatasetCaseCount(0);
      return;
    }
    getDataset(selectedDatasetSlug)
      .then((detail) => setDatasetCaseCount(detail.cases.length))
      .catch(() => setDatasetCaseCount(0));
  }, [selectedDatasetSlug]);

  const filteredModels = useMemo(() => {
    if (!modelSearch.trim()) return models;
    const q = modelSearch.trim().toLowerCase();
    return models.filter(
      (m) =>
        m.id.toLowerCase().includes(q) ||
        m.name.toLowerCase().includes(q) ||
        m.provider.toLowerCase().includes(q),
    );
  }, [models, modelSearch]);

  const canAdvance = useMemo(() => {
    if (step === 0) return selectedDatasetSlug !== "";
    if (step === 1) return agent1ModelId !== "";
    if (step === 2) return agent2ModelId !== "";
    if (step === 3) return name.trim() !== "" && launchStatus === "idle";
    return false;
  }, [step, selectedDatasetSlug, agent1ModelId, agent2ModelId, name, launchStatus]);

  const totalRuns = datasetCaseCount * 2;

  async function handleLaunch() {
    if (!selectedDatasetSlug || !agent1ModelId || !agent2ModelId || !name.trim()) return;

    setLaunchStatus("launching");
    setLaunchError("");

    try {
      const mode =
        agent1Mode === agent2Mode
          ? (agent1Mode.replace(/-/g, "_") as "plan_only" | "implementation_only" | "end_to_end")
          : "end_to_end";

      const benchmark = await createBenchmark({
        name: name.trim(),
        datasetId: selectedDataset?.id ?? selectedDatasetSlug,
        mode,
        agentConfigs: [
          { modelId: agent1ModelId, mode: agent1Mode.replace(/-/g, "_") as "plan_only" | "implementation_only" | "end_to_end" },
          { modelId: agent2ModelId, mode: agent2Mode.replace(/-/g, "_") as "plan_only" | "implementation_only" | "end_to_end" },
        ],
      });

      setLaunchStatus("starting");

      await startBenchmark(benchmark.id);

      setLaunchStatus("success");
      router.push(`/benchmarks/${benchmark.id}`);
    } catch (err) {
      setLaunchStatus("failed");
      setLaunchError(err instanceof Error ? err.message : String(err));
    }
  }

  function nextStep() {
    if (step < STEPS.length - 1) setStep((s) => s + 1);
  }
  function prevStep() {
    if (step > 0) setStep((s) => s - 1);
  }

  const selectedDataset = datasets.find((d) => d.slug === selectedDatasetSlug);
  const agent1Model = models.find((m) => m.id === agent1ModelId);
  const agent2Model = models.find((m) => m.id === agent2ModelId);

  return (
    <div className="mdl-page wz-page">
      <Hero
        eyebrow={`New benchmark · Step ${step + 1} of ${STEPS.length}`}
        live={launchStatus === "launching" || launchStatus === "starting"}
        title={
          <>
            <em>Pit</em> two agents against each other.
          </>
        }
        lede="Select a frozen dataset, configure two agents, review the run matrix, then launch. Both agents run across every case in parallel."
        meta={[
          ["Dataset", selectedDataset?.name ?? "Not selected"],
          ["Cases", String(datasetCaseCount)],
          ["Est. Runs", String(totalRuns)],
        ]}
      />

      {error && (
        <div className="mdl-err" style={{ margin: "24px auto" }}>
          <h3>Setup error</h3>
          <p>{error}</p>
        </div>
      )}

      {/* Wizard rail */}
      <nav className="wz-rail" aria-label="Wizard steps">
        {STEPS.map((s, index) => {
          const state = index === step ? "active" : index < step ? "complete" : "todo";
          return (
            <a className={`wz-step wz-${state}`} href={`#${s.id}`} key={s.id}>
              <span className="wz-step-num">
                {state === "complete" ? (
                  <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M2 6.5L5 9.5L10 3.5" />
                  </svg>
                ) : (
                  index + 1
                )}
              </span>
              <span className="wz-step-label">{s.label}</span>
            </a>
          );
        })}
      </nav>

      {/* Step 0: Select Dataset */}
      {step === 0 && (
        <section className="wz-card" id="dataset">
          <div className="wz-step-h">
            <span className="wz-num">01</span>
            <h2>
              Select a <em>dataset</em>
            </h2>
          </div>

          {datasetsLoading ? (
            <div className="mdl-loading">
              <span className="pulse" />
              Loading datasets…
            </div>
          ) : datasets.length === 0 ? (
            <EmptyState
              compact
              title="No datasets available"
              description="Create a dataset with frozen cases before running a benchmark."
            />
          ) : (
            <div className="dsn-cases" style={{ maxHeight: 360, overflow: "auto" }}>
              {datasets.map((ds) => {
                const selected = selectedDatasetSlug === ds.slug;
                return (
                  <div
                    key={ds.id}
                    className={"dsn-case-row" + (selected ? " added" : "")}
                    onClick={() => setSelectedDatasetSlug(ds.slug)}
                  >
                    <div className="check">
                      {selected && (
                        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M2 6.5L5 9.5L10 3.5" />
                        </svg>
                      )}
                    </div>
                    <div className="case-main">
                      <div className="ti">{ds.name}</div>
                      <div className="id">
                        {ds.slug} · {ds.caseCount} case{ds.caseCount === 1 ? "" : "s"} · {ds.tags.slice(0, 3).join(", ")}
                      </div>
                    </div>
                    <StatusPill status={ds.status} />
                  </div>
                );
              })}
            </div>
          )}

          <div className="wz-actions">
            <button className="btn2" disabled type="button">Back</button>
            <button className="btn2 primary" disabled={!canAdvance} onClick={nextStep} type="button">
              Continue →
            </button>
          </div>
        </section>
      )}

      {/* Step 1: Configure Agent 1 */}
      {step === 1 && (
        <section className="wz-card" id="agent1">
          <div className="wz-step-h">
            <span className="wz-num">02</span>
            <h2>
              Configure <em>Agent 1</em>
            </h2>
          </div>

          {/* Model search */}
          <div className="mdl-filters" style={{ position: "static", border: "none", padding: 0, marginTop: 0 }}>
            <div className="search" style={{ minWidth: 0, flex: 1 }}>
              <svg aria-hidden="true" width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="5.5" cy="5.5" r="3.5" />
                <path d="M8.5 8.5L11 11" />
              </svg>
              <input
                aria-label="Search models"
                onChange={(e) => setModelSearch(e.target.value)}
                placeholder="Filter models…"
                value={modelSearch}
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
                const on = agent1ModelId === m.id;
                return (
                  <li key={m.id}>
                    <button
                      aria-pressed={on}
                      className={"exp-model-row" + (on ? " on" : "")}
                      onClick={() => setAgent1ModelId(m.id)}
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

          {/* Mode selector */}
          <div style={{ marginTop: 16 }}>
            <label className="wz-field" style={{ marginBottom: 8 }}>Run mode</label>
            <div className="exp-harness" style={{ background: "none", padding: 0 }}>
              {MODES.map((m) => (
                <button
                  key={m.value}
                  className={"exp-radio" + (agent1Mode === m.value ? " on" : "")}
                  onClick={() => setAgent1Mode(m.value)}
                  type="button"
                >
                  <span className="rdot" />
                  <span>{m.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="wz-actions">
            <button className="btn2" onClick={prevStep} type="button">← Back</button>
            <button className="btn2 primary" disabled={!canAdvance} onClick={nextStep} type="button">
              Continue →
            </button>
          </div>
        </section>
      )}

      {/* Step 2: Configure Agent 2 */}
      {step === 2 && (
        <section className="wz-card" id="agent2">
          <div className="wz-step-h">
            <span className="wz-num">03</span>
            <h2>
              Configure <em>Agent 2</em>
            </h2>
          </div>

          {/* Model search */}
          <div className="mdl-filters" style={{ position: "static", border: "none", padding: 0, marginTop: 0 }}>
            <div className="search" style={{ minWidth: 0, flex: 1 }}>
              <svg aria-hidden="true" width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="5.5" cy="5.5" r="3.5" />
                <path d="M8.5 8.5L11 11" />
              </svg>
              <input
                aria-label="Search models"
                onChange={(e) => setModelSearch(e.target.value)}
                placeholder="Filter models…"
                value={modelSearch}
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
                const on = agent2ModelId === m.id;
                return (
                  <li key={m.id}>
                    <button
                      aria-pressed={on}
                      className={"exp-model-row" + (on ? " on" : "")}
                      onClick={() => setAgent2ModelId(m.id)}
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

          {/* Mode selector */}
          <div style={{ marginTop: 16 }}>
            <label className="wz-field" style={{ marginBottom: 8 }}>Run mode</label>
            <div className="exp-harness" style={{ background: "none", padding: 0 }}>
              {MODES.map((m) => (
                <button
                  key={m.value}
                  className={"exp-radio" + (agent2Mode === m.value ? " on" : "")}
                  onClick={() => setAgent2Mode(m.value)}
                  type="button"
                >
                  <span className="rdot" />
                  <span>{m.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="wz-actions">
            <button className="btn2" onClick={prevStep} type="button">← Back</button>
            <button className="btn2 primary" disabled={!canAdvance} onClick={nextStep} type="button">
              Continue →
            </button>
          </div>
        </section>
      )}

      {/* Step 3: Review & Launch */}
      {step === 3 && (
        <section className="wz-card" id="review">
          <div className="wz-step-h">
            <span className="wz-num">04</span>
            <h2>
              Review <em>&amp; launch</em>
            </h2>
          </div>

          {/* Name input */}
          <label className="wz-field" style={{ marginBottom: 20 }}>
            <span>Benchmark name</span>
            <input
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. GPT-5.4-mini vs Claude-4 on react-flight"
              value={name}
            />
          </label>

          {/* Matrix summary */}
          <div className="grid-2" style={{ marginBottom: 20 }}>
            <div className="card2">
              <div className="card2-hd">
                <span className="card2-ti">Agent 1</span>
              </div>
              <div style={{ fontFamily: "var(--mono)", fontSize: 12 }}>
                <div><strong>Model:</strong> {agent1Model?.name ?? agent1ModelId}</div>
                <div style={{ color: "var(--ink-1)", fontSize: 11 }}>{agent1ModelId}</div>
                <div style={{ marginTop: 6 }}>
                  <StatusPill status={agent1Mode} />
                </div>
              </div>
            </div>
            <div className="card2">
              <div className="card2-hd">
                <span className="card2-ti">Agent 2</span>
              </div>
              <div style={{ fontFamily: "var(--mono)", fontSize: 12 }}>
                <div><strong>Model:</strong> {agent2Model?.name ?? agent2ModelId}</div>
                <div style={{ color: "var(--ink-1)", fontSize: 11 }}>{agent2ModelId}</div>
                <div style={{ marginTop: 6 }}>
                  <StatusPill status={agent2Mode} />
                </div>
              </div>
            </div>
          </div>

          {/* Dataset info */}
          <div className="card2" style={{ marginBottom: 20 }}>
            <div className="card2-hd">
              <span className="card2-ti">Dataset</span>
            </div>
            <div style={{ fontFamily: "var(--mono)", fontSize: 12 }}>
              <div><strong>{selectedDataset?.name ?? selectedDatasetSlug}</strong></div>
              <div style={{ color: "var(--ink-1)", fontSize: 11 }}>
                {datasetCaseCount} case{datasetCaseCount === 1 ? "" : "s"} · {totalRuns} runs
              </div>
            </div>
          </div>

          {/* Run matrix preview */}
          <div className="card2" style={{ marginBottom: 20 }}>
            <div className="card2-hd">
              <span className="card2-ti">Run matrix</span>
              <span style={{ color: "var(--ink-4)", fontFamily: "var(--mono)", fontSize: 11 }}>
                {totalRuns} cells
              </span>
            </div>
            <div className="exp-matrix">
              <div />
              <b>Plan</b>
              <b>Impl</b>
              <b>Test</b>
              {[
                { label: "Agent 1", model: agent1Model?.name ?? agent1ModelId, mode: agent1Mode },
                { label: "Agent 2", model: agent2Model?.name ?? agent2ModelId, mode: agent2Mode },
              ].map((a) => (
                <div className="exp-matrix-row" key={a.label}>
                  <span>{a.model.split("/").pop()}</span>
                  <button className="on" aria-label="plan" type="button" />
                  <button className={a.mode !== "plan-only" ? "on" : ""} aria-label="impl" type="button" />
                  <button className={a.mode === "end-to-end" ? "on" : ""} aria-label="test" type="button" />
                </div>
              ))}
            </div>
          </div>

          {/* Launch button */}
          <div className="wz-actions">
            <button className="btn2" disabled={launchStatus !== "idle"} onClick={prevStep} type="button">
              ← Back
            </button>
            <button
              className="btn2 primary"
              disabled={!canAdvance}
              onClick={handleLaunch}
              type="button"
            >
              {launchStatus === "idle" && "Launch benchmark →"}
              {launchStatus === "launching" && "Creating benchmark…"}
              {launchStatus === "starting" && "Starting runs…"}
              {launchStatus === "success" && "Redirecting…"}
              {launchStatus === "failed" && "Retry →"}
            </button>
          </div>

          {launchError && <p className="wz-msg fail">{launchError}</p>}
        </section>
      )}
    </div>
  );
}
