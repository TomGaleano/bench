"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Hero } from "../../components/ui/Hero";
import { ModelPicker } from "../../components/playground/ModelPicker";
import { AgentPanel } from "../../components/playground/AgentPanel";
import { ScoringPanel } from "../../components/playground/ScoringPanel";
import {
  listModels,
  startPlayground,
  getPlaygroundSession,
  getPlaygroundEvents,
  openPlaygroundEventStream,
  scorePlayground,
  autoGradePlayground,
  savePlaygroundSession,
  unsavePlaygroundSession,
  releasePlaygroundSandbox,
  type ModelInfo,
  type PlaygroundSessionResponse,
  type PlaygroundEventResponse,
} from "../../lib/api";

type Step = "compose" | "live" | "score";

export default function PlaygroundPage() {
  const [step, setStep] = useState<Step>("compose");
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set());
  const [prompt, setPrompt] = useState("");
  const [graderModelId, setGraderModelId] = useState("");

  const [session, setSession] = useState<PlaygroundSessionResponse | null>(null);
  const [sessionEvents, setSessionEvents] = useState<PlaygroundEventResponse[]>([]);
  const [error, setError] = useState("");
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    listModels()
      .then((data) => setModels(data))
      .catch(() => undefined);
  }, []);

  function toggleModel(id: string) {
    setSelectedModels((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else if (next.size < 5) {
        next.add(id);
      }
      return next;
    });
  }

  // Subscribe to the WebSocket stream + light session-status polling.
  useEffect(() => {
    if (!session || step !== "live") return;

    const sessionId = session.id;
    let cancelled = false;

    // Backfill events emitted before WS opened, then attach to the stream.
    getPlaygroundEvents(sessionId)
      .then((initial) => {
        if (cancelled) return;
        setSessionEvents(initial);
      })
      .catch(() => undefined);

    const ws = openPlaygroundEventStream(
      sessionId,
      (event) => {
        setSessionEvents((prev) => {
          if (prev.some((e) => e.id === event.id)) return prev;
          // Insert preserving seq order
          const next = [...prev, event];
          next.sort((a, b) => a.seq - b.seq);
          return next;
        });
      },
      { onError: () => undefined },
    );
    wsRef.current = ws;

    // Session-status polling: slower than the old loop now that events stream.
    // Do NOT auto-advance to the scoring step — the user clicks "Continue to scoring →"
    // when they're ready to leave the live transcripts.
    const pollSession = async () => {
      try {
        const updated = await getPlaygroundSession(sessionId);
        if (cancelled) return;
        setSession(updated);
      } catch {
        /* ignore */
      }
    };
    pollSession();
    const interval = setInterval(pollSession, 4000);

    return () => {
      cancelled = true;
      clearInterval(interval);
      ws.close();
      wsRef.current = null;
    };
  }, [session?.id, step]);

  const canLaunch = prompt.trim().length >= 10 && selectedModels.size >= 2 && selectedModels.size <= 5;

  async function handleLaunch() {
    setError("");

    try {
      const result = await startPlayground({
        prompt: prompt.trim(),
        models: Array.from(selectedModels).map((id) => {
          const m = models.find((m) => m.id === id);
          return { id, name: m?.name ?? id };
        }),
        ...(graderModelId.trim() ? { graderModelId: graderModelId.trim() } : {}),
      });

      setSession(result);
      setSessionEvents([]);
      setStep("live");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleScore(scores: Array<{ agentRunId: string; score: number; rationale?: string | undefined }>) {
    if (!session) return;
    await scorePlayground(session.id, scores);
    const updated = await getPlaygroundSession(session.id);
    setSession(updated);
  }

  async function handleAutoGrade() {
    if (!session) return;
    await autoGradePlayground(session.id);
    const updated = await getPlaygroundSession(session.id);
    setSession(updated);
  }

  async function toggleSaved() {
    if (!session) return;
    try {
      if (session.saved) {
        await unsavePlaygroundSession(session.id);
        setSession({ ...session, saved: false });
      } else {
        await savePlaygroundSession(session.id);
        setSession({ ...session, saved: true });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const allCompleted = useMemo(
    () => session?.agentRuns.every((r) => r.status === "succeeded" || r.status === "failed") ?? false,
    [session],
  );
  const allFailed = useMemo(
    () =>
      Boolean(
        session &&
          session.agentRuns.length > 0 &&
          session.agentRuns.every((r) => r.status === "failed"),
      ),
    [session],
  );

  const heroActions = step !== "compose" && session ? (
    <div style={{ display: "flex", gap: 8 }}>
      <button
        className="btn2"
        onClick={toggleSaved}
        type="button"
        title={session.saved ? "Unsave" : "Save session"}
        aria-label={session.saved ? "Unsave session" : "Save session"}
        style={{ color: session.saved ? "#f59e0b" : undefined }}
      >
        {session.saved ? "★ Saved" : "☆ Save"}
      </button>
      <Link className="btn2" href={`/playground`}>← New playground</Link>
      <Link className="btn2" href={`/playground/saved`}>Saved sessions</Link>
    </div>
  ) : (
    <Link className="btn2" href={`/playground/saved`}>Saved sessions</Link>
  );

  return (
    <div className="mdl-page playground-page">
      <Hero
        eyebrow="Playground"
        title={
          step === "compose"
            ? <>Give models a <em>task</em> to compare.</>
            : step === "live"
              ? <>Watch agents <em>build</em> in real time.</>
              : <>Score the <em>results</em>.</>
        }
        lede={
          step === "compose"
            ? "Pick 2-5 models, give them a task, and see how each one builds it from scratch in an isolated sandbox."
            : step === "live"
              ? "Each agent has its own sandbox. Watch them code, run commands, and build your app — token by token."
              : "Review what each agent built, then score them manually or let AI judge."
        }
        actions={heroActions}
      />

      {error && (
        <div className="mdl-err" style={{ margin: "24px auto" }}>
          <h3>Something went wrong</h3>
          <p>{error}</p>
        </div>
      )}

      {step === "compose" && (
        <div className="exp-split">
          <div style={{ flex: 1 }}>
            <section className="card2" style={{ marginBottom: 16 }}>
              <div className="card2-hd">
                <span className="card2-ti">Task</span>
              </div>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder='Create a Python Flask todo web app with SQLite…'
                style={{
                  width: "100%",
                  minHeight: 120,
                  padding: 12,
                  fontSize: 14,
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: "var(--surface)",
                  color: "var(--ink-2)",
                  resize: "vertical",
                  fontFamily: "var(--mono)",
                }}
                rows={5}
              />
              <div style={{ marginTop: 8, fontSize: 12, color: "var(--ink-4)" }}>
                {prompt.length < 10
                  ? "Describe the task in detail (at least 10 characters)"
                  : `${prompt.length} characters`}
              </div>
            </section>

            <ModelPicker
              models={models}
              selectedModels={selectedModels}
              onToggle={toggleModel}
              minSelection={2}
              maxSelection={5}
            />
          </div>

          <aside className="exp-side">
            <section className="card2">
              <div className="card2-hd">
                <span className="card2-ti">Options</span>
              </div>

              <label className="exp-field">
                <span>Auto-grader model ID (optional)</span>
                <input
                  value={graderModelId}
                  onChange={(e) => setGraderModelId(e.target.value)}
                  placeholder="openai/gpt-4o"
                />
              </label>
            </section>

            <section className="card2">
              <div className="card2-hd">
                <span className="card2-ti">Preflight</span>
              </div>
              <ul className="exp-preflight">
                <li className={prompt.trim().length >= 10 ? "pf-ok" : "pf-fail"}>
                  <span className="pip" />
                  <div className="pf-text">
                    <strong>Task</strong>
                    <small>{prompt.trim().length >= 10 ? `${prompt.length} chars` : "Too short"}</small>
                  </div>
                </li>
                <li className={selectedModels.size >= 2 ? "pf-ok" : "pf-fail"}>
                  <span className="pip" />
                  <div className="pf-text">
                    <strong>Models</strong>
                    <small>{selectedModels.size >= 2 ? `${selectedModels.size} selected` : "Select 2-5"}</small>
                  </div>
                </li>
                <li className={selectedModels.size <= 5 ? "pf-ok" : "pf-fail"}>
                  <span className="pip" />
                  <div className="pf-text">
                    <strong>Max models</strong>
                    <small>{selectedModels.size <= 5 ? "Within limit" : "Max 5"}</small>
                  </div>
                </li>
              </ul>
            </section>

            <section className="card2">
              <div className="card2-hd">
                <span className="card2-ti">Launch</span>
              </div>
              <button
                className="btn2 primary"
                disabled={!canLaunch}
                onClick={handleLaunch}
                style={{ width: "100%" }}
                type="button"
              >
                Launch playground →
              </button>
              <p style={{ fontSize: 11, color: "var(--ink-4)", marginTop: 8, textAlign: "center" }}>
                Each agent gets its own E2B sandbox
              </p>
            </section>
          </aside>
        </div>
      )}

      {step === "live" && session && (
        <>
          {allFailed && (
            <div className="mdl-err" style={{ margin: "16px 0" }}>
              <h3>All agents failed</h3>
              <p>None of the agents produced a usable output. You can review the transcripts below or start a new playground.</p>
            </div>
          )}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(${Math.min(session.agentRuns.length, 3)}, 1fr)`,
              gap: 16,
            }}
          >
            {session.agentRuns.map((run) => (
              <AgentPanel
                key={run.id}
                agentRun={run}
                events={sessionEvents.filter((e) => e.agentRunId === run.id)}
              />
            ))}
          </div>
          {allCompleted && !allFailed && (
            <div style={{ textAlign: "center", marginTop: 16 }}>
              <button
                className="btn2 primary"
                onClick={() => {
                  // Tell the worker it can tear down the shared sandbox.
                  if (session) {
                    void releasePlaygroundSandbox(session.id).catch(() => undefined);
                  }
                  setStep("score");
                }}
                type="button"
              >
                Continue to scoring →
              </button>
            </div>
          )}
        </>
      )}

      {step === "score" && session && (
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <ScoringPanel
            agentRuns={session.agentRuns}
            sessionId={session.id}
            graderModelId={session.graderModelId}
            onScore={handleScore}
            onAutoGrade={handleAutoGrade}
            allCompleted={allCompleted}
          />
        </div>
      )}
    </div>
  );
}
