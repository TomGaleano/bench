"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Hero } from "../../../components/ui/Hero";
import {
  listSavedPlaygroundSessions,
  unsavePlaygroundSession,
  type PlaygroundSessionResponse,
} from "../../../lib/api";

export default function SavedPlaygroundSessionsPage() {
  const [sessions, setSessions] = useState<PlaygroundSessionResponse[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    listSavedPlaygroundSessions()
      .then((data) => {
        if (!cancelled) setSessions(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleUnsave(id: string) {
    try {
      await unsavePlaygroundSession(id);
      setSessions((prev) => prev?.filter((s) => s.id !== id) ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="mdl-page">
      <Hero
        eyebrow="Playground"
        title={<>Saved <em>sessions</em>.</>}
        lede="Pinned playground sessions you wanted to come back to."
        actions={<Link className="btn2" href="/playground">← New playground</Link>}
      />

      {error && (
        <div className="mdl-err" style={{ margin: "16px 0" }}>
          <h3>Couldn&rsquo;t load saved sessions</h3>
          <p>{error}</p>
        </div>
      )}

      {sessions === null ? (
        <p style={{ color: "var(--ink-4)", fontStyle: "italic" }}>Loading…</p>
      ) : sessions.length === 0 ? (
        <p style={{ color: "var(--ink-4)", fontStyle: "italic" }}>
          No saved sessions yet. Star a session from the playground to pin it here.
        </p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          {sessions.map((s) => (
            <li
              key={s.id}
              className="card2"
              style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                  <strong style={{ fontSize: 13, fontFamily: "var(--mono)" }}>
                    {s.id.slice(0, 8)}
                  </strong>
                  <small style={{ color: "var(--ink-4)" }}>
                    {new Date(s.createdAt).toLocaleString()} · {s.agentRuns.length} agent
                    {s.agentRuns.length === 1 ? "" : "s"} · status {s.status}
                  </small>
                </div>
                <p
                  style={{
                    margin: "6px 0 0",
                    color: "var(--ink-2)",
                    whiteSpace: "pre-wrap",
                    fontSize: 13,
                    maxHeight: 80,
                    overflow: "hidden",
                  }}
                >
                  {s.prompt}
                </p>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
                <button
                  type="button"
                  className="btn2"
                  onClick={() => handleUnsave(s.id)}
                  title="Unsave"
                  style={{ color: "#f59e0b" }}
                >
                  ★ Unsave
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
