"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { EventTimeline } from "../../components/replay/EventTimeline";
import { OutcomeCard } from "../../components/replay/OutcomeCard";
import { ToolUsageBar } from "../../components/replay/ToolUsageBar";
import { Hero } from "../../components/ui/Hero";
import { SectionHeader } from "../../components/ui/SectionHeader";
import type { DurableRunEvent, RunSummary } from "../../lib/api";
import { getRun, getRunEvents, listRuns } from "../../lib/api";

function describeEvent(event: DurableRunEvent) {
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  if (typeof payload.delta === "string") return payload.delta;
  if (typeof payload.status === "string") return payload.status;
  if (typeof payload.toolName === "string") return payload.toolName;
  if (typeof payload.objectKey === "string") return payload.objectKey;
  if (typeof payload.message === "string") return payload.message;
  return JSON.stringify(payload, null, 2).slice(0, 600);
}

export default function ReplayPage() {
  const [run, setRun] = useState<RunSummary | null>(null);
  const [events, setEvents] = useState<DurableRunEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [focusId, setFocusId] = useState<string | null>(null);

  const assistantText = useMemo(
    () =>
      events
        .filter((e) => e.kind === "assistant_text_delta")
        .map((e) => {
          const payload = e.payload as { delta?: unknown };
          return typeof payload?.delta === "string" ? payload.delta : "";
        })
        .join(""),
    [events],
  );

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const params = new URLSearchParams(window.location.search);
        let runId = params.get("runId");
        if (!runId) {
          const [latest] = await listRuns();
          runId = latest?.id ?? null;
        }
        if (!runId) {
          if (!cancelled) setLoading(false);
          return;
        }
        const [nextRun, nextEvents] = await Promise.all([
          getRun(runId),
          getRunEvents(runId),
        ]);
        if (!cancelled) {
          setRun(nextRun);
          setEvents(nextEvents);
          setError("");
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      }
    }
    void load();
    const interval = window.setInterval(load, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  const focusEvent = useMemo(
    () => events.find((e) => e.id === focusId) ?? events[events.length - 1] ?? null,
    [events, focusId],
  );

  if (loading) {
    return (
      <div className="mdl-page">
        <div className="mdl-loading">
          <span className="pulse" />
          Loading replay…
        </div>
      </div>
    );
  }

  return (
    <div className="mdl-page replay-page">
      <Hero
        eyebrow={
          <>
            Replay {run ? `· ${run.id.slice(0, 8)}` : ""}
          </>
        }
        live={run?.status === "running"}
        title={
          <>
            <em>Replay</em> a run, frame by frame.
          </>
        }
        lede="Every assistant turn, tool call, patch, and test event in order. Click a node on the timeline to inspect its payload; the right rail summarises outcome and tool spend."
        meta={
          run
            ? [
                ["Run", run.id.slice(0, 8)],
                ["Events", String(events.length)],
                ["Status", run.status],
              ]
            : undefined
        }
        actions={
          <Link className="btn2" href="/runs">
            ← All runs
          </Link>
        }
      />

      {error && (
        <div className="mdl-err" style={{ margin: "24px auto" }}>
          <h3>Couldn&apos;t load replay</h3>
          <p>{error}</p>
        </div>
      )}

      {!run ? (
        <div className="mdl-loading" style={{ fontStyle: "italic" }}>
          No runs to replay yet — launch an experiment first.
        </div>
      ) : (
        <>
          <SectionHeader num="01">
            Run <em>timeline</em>
          </SectionHeader>
          <EventTimeline events={events} focusId={focusId} onFocus={setFocusId} />

          <div className="replay-split">
            <section className="card2 replay-event">
              <div className="card2-hd">
                <span className="card2-ti">
                  {focusEvent ? `Event ${focusEvent.seq} · ${focusEvent.stage}` : "Event detail"}
                </span>
                {focusEvent && (
                  <span
                    style={{
                      color: "var(--ink-4)",
                      fontFamily: "var(--mono)",
                      fontSize: 11,
                    }}
                  >
                    {new Date(focusEvent.timestamp).toLocaleTimeString()}
                  </span>
                )}
              </div>
              {focusEvent ? (
                <>
                  <span className="mdl-tag" style={{ marginBottom: 10 }}>
                    {focusEvent.kind.replace(/_/g, " ")}
                  </span>
                  <pre className="replay-pre">{describeEvent(focusEvent)}</pre>
                </>
              ) : (
                <p style={{ color: "var(--ink-4)" }}>Click a node on the timeline to inspect it.</p>
              )}
            </section>

            <aside className="replay-side">
              <OutcomeCard run={run} eventCount={events.length} />
              <ToolUsageBar events={events} />
              {(assistantText || run.plan?.markdown) && (
                <section className="card2">
                  <div className="card2-hd">
                    <span className="card2-ti">Plan preview</span>
                    {run.plan?.artifact && (
                      <span
                        style={{
                          color: "var(--ink-4)",
                          fontFamily: "var(--mono)",
                          fontSize: 11,
                        }}
                      >
                        {run.plan.artifact.byteSize ?? 0} bytes
                      </span>
                    )}
                  </div>
                  <pre className="replay-pre subtle">
                    {assistantText || run.plan?.markdown}
                  </pre>
                </section>
              )}
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
