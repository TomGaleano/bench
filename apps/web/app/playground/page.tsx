"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Hero } from "../../components/ui/Hero";
import { ComposeStep } from "../../components/playground/ComposeStep";
import { LiveStep } from "../../components/playground/LiveStep";
import { ScoringPanel } from "../../components/playground/ScoringPanel";
import {
  PLAYGROUND_ADVANCED_DEFAULTS,
  type PlaygroundAdvancedOptions,
} from "../../components/playground/AdvancedDrawer";
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
  stopPlaygroundAgentRun,
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
  const [advanced, setAdvanced] = useState<PlaygroundAdvancedOptions>(PLAYGROUND_ADVANCED_DEFAULTS);
  const [launching, setLaunching] = useState(false);

  const [session, setSession] = useState<PlaygroundSessionResponse | null>(null);
  const [sessionEvents, setSessionEvents] = useState<PlaygroundEventResponse[]>([]);
  const [error, setError] = useState("");
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    listModels()
      .then((data) => setModels(data))
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      });
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

  function removeSelected(id: string) {
    setSelectedModels((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  function applyPreset(modelIds: string[]) {
    setSelectedModels(new Set(modelIds.slice(0, 5)));
  }

  // Subscribe to the WebSocket stream + light session-status polling.
  useEffect(() => {
    if (!session || step !== "live") return;

    const sessionId = session.id;
    let cancelled = false;

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
          const next = [...prev, event];
          next.sort((a, b) => a.seq - b.seq);
          return next;
        });
      },
      { onError: () => undefined },
    );
    wsRef.current = ws;

    const pollSession = async () => {
      try {
        const updated = await getPlaygroundSession(sessionId);
        if (cancelled) return;
        setSession(updated);
      } catch {
        /* ignore */
      }
    };
    void pollSession();
    const interval = setInterval(pollSession, 4000);

    return () => {
      cancelled = true;
      clearInterval(interval);
      ws.close();
      wsRef.current = null;
    };
  }, [session?.id, step]);

  const canLaunch =
    prompt.trim().length >= 10 &&
    selectedModels.size >= 2 &&
    selectedModels.size <= 5 &&
    !launching;

  const allCompleted = useMemo(
    () =>
      session?.agentRuns.every(
        (r) => r.status === "succeeded" || r.status === "failed",
      ) ?? false,
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

  const handleLaunch = useCallback(async () => {
    setError("");
    setLaunching(true);
    try {
      const result = await startPlayground({
        prompt: prompt.trim(),
        models: Array.from(selectedModels).map((id) => {
          const m = models.find((m) => m.id === id);
          return { id, name: m?.name ?? id };
        }),
        ...(graderModelId.trim() ? { graderModelId: graderModelId.trim() } : {}),
        maxWallClockSeconds: advanced.maxWallClockSeconds,
        maxOutputTokensPerAgent: advanced.maxOutputTokensPerAgent,
        tools: advanced.tools,
        sandboxImage: advanced.sandboxImage,
        seedPromptText: advanced.seedPromptText,
        runTwiceAndAverage: advanced.runTwiceAndAverage,
      });
      setSession(result);
      setSessionEvents([]);
      setStep("live");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLaunching(false);
    }
  }, [advanced, graderModelId, models, prompt, selectedModels]);

  async function handleScore(
    scores: Array<{ agentRunId: string; score: number; rationale?: string | undefined }>,
  ) {
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

  async function handleStopAgent(agentRunId: string) {
    if (!session) return;
    try {
      await stopPlaygroundAgentRun(session.id, agentRunId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function handleContinueToScoring() {
    if (!session) return;
    void releasePlaygroundSandbox(session.id).catch(() => undefined);
    setStep("score");
  }

  const heroActions =
    step !== "compose" && session ? (
      <div style={{ display: "flex", gap: 8 }}>
        <button
          className="btn2"
          onClick={toggleSaved}
          type="button"
          title={session.saved ? "Unsave" : "Save session"}
          aria-label={session.saved ? "Unsave session" : "Save session"}
          style={{ color: session.saved ? "var(--accent)" : undefined }}
        >
          {session.saved ? "★ Saved" : "☆ Save"}
        </button>
        <Link className="btn2" href="/playground">
          ← New playground
        </Link>
        <Link className="btn2" href="/playground/saved">
          Saved sessions
        </Link>
      </div>
    ) : (
      <Link className="btn2" href="/playground/saved">
        Saved sessions
      </Link>
    );

  return (
    <div className="mdl-page playground-page">
      <Hero
        eyebrow="Playground"
        title={
          step === "compose" ? (
            <>
              <em>Give models</em> a task to compare.
            </>
          ) : step === "live" ? (
            <>
              <em>Watch agents</em> build in real time.
            </>
          ) : (
            <>
              <em>Compare</em> first, score second.
            </>
          )
        }
        lede={
          step === "compose"
            ? "Pick 2–5 models, write the task, and watch each one build it from scratch in an isolated sandbox."
            : step === "live"
              ? "Each agent runs in its own E2B sandbox on a private git worktree — token by token, tool call by tool call."
              : "Each tile is a live preview of what the agent built. Score by rubric or hand it off to an autograder."
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
        <ComposeStep
          models={models}
          prompt={prompt}
          onPromptChange={setPrompt}
          selectedModels={selectedModels}
          onToggleModel={toggleModel}
          onApplyPreset={applyPreset}
          onRemoveSelected={removeSelected}
          graderModelId={graderModelId}
          onGraderModelIdChange={setGraderModelId}
          advanced={advanced}
          onAdvancedChange={setAdvanced}
          canLaunch={canLaunch}
          launching={launching}
          onLaunch={handleLaunch}
        />
      )}

      {step === "live" && session && (
        <LiveStep
          session={session}
          events={sessionEvents}
          maxWallClockSeconds={advanced.maxWallClockSeconds}
          allCompleted={allCompleted}
          allFailed={allFailed}
          onContinue={handleContinueToScoring}
          onStopAgent={handleStopAgent}
        />
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
