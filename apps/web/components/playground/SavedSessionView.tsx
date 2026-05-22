"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Hero } from "../ui/Hero";
import {
  getPlaygroundAutograders,
  getPlaygroundEvents,
  patchPlaygroundSession,
  type PlaygroundAutograderRunResponse,
  type PlaygroundEventResponse,
  type PlaygroundSessionResponse,
} from "../../lib/api";
import { AgentPanel } from "./AgentPanel";
import { ComparisonTile } from "./ComparisonTile";
import { AutogradePanel } from "./AutogradePanel";
import { pgVendor } from "../../lib/playground-vendor";

type SavedSessionViewProps = {
  session: PlaygroundSessionResponse;
  readOnlyShare?: boolean;
};

export function SavedSessionView({ session: initialSession, readOnlyShare }: SavedSessionViewProps) {
  const [session, setSession] = useState(initialSession);
  const [events, setEvents] = useState<PlaygroundEventResponse[]>([]);
  const [autograders, setAutograders] = useState<PlaygroundAutograderRunResponse[]>([]);
  const [tagDraft, setTagDraft] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    getPlaygroundEvents(session.id)
      .then((rows) => {
        if (!cancelled) setEvents(rows);
      })
      .catch(() => undefined);
    if (!readOnlyShare) {
      getPlaygroundAutograders(session.id)
        .then((rows) => {
          if (!cancelled) setAutograders(rows);
        })
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
    };
  }, [session.id, readOnlyShare]);

  async function addTag() {
    const tag = tagDraft.trim().toLowerCase();
    if (!tag || session.tags.includes(tag)) return;
    try {
      const next = await patchPlaygroundSession(session.id, { tags: [...session.tags, tag] });
      setSession(next);
      setTagDraft("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function removeTag(tag: string) {
    try {
      const next = await patchPlaygroundSession(session.id, {
        tags: session.tags.filter((t) => t !== tag),
      });
      setSession(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function toggleSaved() {
    try {
      const next = await patchPlaygroundSession(session.id, { saved: !session.saved });
      setSession(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function toggleShare() {
    try {
      const next = await patchPlaygroundSession(session.id, {
        shareEnabled: !session.shareToken,
      });
      setSession(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const shareUrl = session.shareToken
    ? typeof window !== "undefined"
      ? `${window.location.origin}/playground/share/${session.shareToken}`
      : `/playground/share/${session.shareToken}`
    : null;

  return (
    <div className="mdl-page playground-page">
      <Hero
        eyebrow={readOnlyShare ? "Playground · Shared" : "Playground · Saved"}
        title={
          <>
            {session.title ?? truncate(session.prompt, 80)}
          </>
        }
        lede={session.title ? truncate(session.prompt, 200) : undefined}
        actions={
          readOnlyShare ? (
            <Link className="btn2" href="/playground">
              New playground →
            </Link>
          ) : (
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                className="btn2"
                onClick={() => void toggleSaved()}
                style={{ color: session.saved ? "var(--accent)" : undefined }}
              >
                {session.saved ? "★ Saved" : "☆ Save"}
              </button>
              <button type="button" className="btn2" onClick={() => void toggleShare()}>
                {session.shareToken ? "Disable share" : "Create share link"}
              </button>
              <Link className="btn2" href="/playground/saved">
                ← All sessions
              </Link>
            </div>
          )
        }
      />

      {error && (
        <div className="mdl-err" style={{ margin: "16px 0" }}>
          <h3>Something went wrong</h3>
          <p>{error}</p>
        </div>
      )}

      {shareUrl && !readOnlyShare && (
        <section className="pg-card" style={{ margin: "12px 0" }}>
          <div className="pg-card-hd">
            <div className="ti">Share link</div>
            <span className="tag2">public</span>
          </div>
          <div style={{ padding: "12px 18px", display: "flex", gap: 8, alignItems: "center" }}>
            <code style={{ fontFamily: "var(--mono)", fontSize: 12, flex: 1, color: "var(--ink-3)", overflow: "hidden", textOverflow: "ellipsis" }}>
              {shareUrl}
            </code>
            <button
              type="button"
              className="btn2"
              onClick={() => {
                if (typeof navigator !== "undefined") {
                  void navigator.clipboard?.writeText(shareUrl);
                }
              }}
            >
              Copy
            </button>
          </div>
        </section>
      )}

      {!readOnlyShare && (
        <section className="pg-card" style={{ margin: "12px 0" }}>
          <div className="pg-card-hd">
            <div className="ti">Tags</div>
            <span className="tag2">{session.tags.length}</span>
          </div>
          <div style={{ padding: "12px 18px", display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
            {session.tags.map((t) => (
              <span key={t} className="pg-hist-filter on" style={{ display: "inline-flex" }}>
                #{t}
                <button
                  type="button"
                  onClick={() => void removeTag(t)}
                  aria-label={`Remove tag ${t}`}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "inherit",
                    marginLeft: 4,
                    cursor: "pointer",
                  }}
                >
                  ×
                </button>
              </span>
            ))}
            <input
              type="text"
              value={tagDraft}
              onChange={(e) => setTagDraft(e.target.value)}
              placeholder="+ tag"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void addTag();
                }
              }}
              style={{
                fontFamily: "var(--mono)",
                fontSize: 11,
                padding: "4px 10px",
                border: "1px solid var(--rule-2)",
                borderRadius: 999,
                background: "var(--paper)",
                color: "var(--ink)",
                outline: "none",
                minWidth: 100,
              }}
            />
          </div>
        </section>
      )}

      <div
        style={{
          fontFamily: "var(--mono)",
          fontSize: 10.5,
          color: "var(--ink-4)",
          textTransform: "uppercase",
          letterSpacing: "0.07em",
          marginTop: 12,
          marginBottom: 10,
        }}
      >
        results
      </div>
      <div className="pg-tiles">
        {session.agentRuns.map((r) => (
          <ComparisonTile key={r.id} agentRun={r} blindLabel={null} />
        ))}
      </div>

      <div
        style={{
          fontFamily: "var(--mono)",
          fontSize: 10.5,
          color: "var(--ink-4)",
          textTransform: "uppercase",
          letterSpacing: "0.07em",
          marginTop: 20,
          marginBottom: 10,
        }}
      >
        transcripts
      </div>
      <div className="pg-agents" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))" }}>
        {session.agentRuns.map((r, idx) => (
          <AgentPanel
            key={r.id}
            agentRun={r}
            events={events.filter((e) => e.agentRunId === r.id)}
            index={idx}
          />
        ))}
      </div>

      {!readOnlyShare && autograders.length > 0 && (
        <AutogradePanel
          prompt={session.prompt}
          agentRuns={session.agentRuns}
          autograders={autograders}
          primaryGraderId={session.graderModelId ?? "anthropic/claude-haiku-4"}
          models={[]}
          onChangePrimary={() => undefined}
          onGrade={() => undefined}
          isGrading={false}
        />
      )}

      {!readOnlyShare && (
        <div style={{ marginTop: 22, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-3)" }}>
            scored runs:{" "}
            <b style={{ color: "var(--ink)" }}>
              {session.agentRuns.filter((r) => r.score != null).length}
            </b>{" "}
            of {session.agentRuns.length}
          </div>
          {session.agentRuns.some((r) => r.score != null) && (
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-4)" }}>
                winner:
              </span>
              {(() => {
                const winner = [...session.agentRuns]
                  .filter((r) => r.score != null)
                  .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0];
                if (!winner) return null;
                return (
                  <div style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                    <span
                      className="pg-vendor-dot"
                      style={{ background: pgVendor(winner.modelId), width: 8, height: 8 }}
                    />
                    <span style={{ fontFamily: "var(--serif)", fontSize: 16 }}>{winner.modelName}</span>
                    <span
                      style={{
                        fontFamily: "var(--serif)",
                        fontStyle: "italic",
                        fontSize: 20,
                        color: "var(--accent)",
                      }}
                    >
                      {winner.score}
                    </span>
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}
