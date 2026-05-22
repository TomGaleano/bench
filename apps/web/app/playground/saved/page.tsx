"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Hero } from "../../../components/ui/Hero";
import {
  listPlaygroundHistory,
  getPlaygroundLeaderboard,
  patchPlaygroundSession,
  type PlaygroundSessionResponse,
  type PlaygroundLeaderboardResponse,
} from "../../../lib/api";
import { pgVendor } from "../../../lib/playground-vendor";

type StarredFilter = "all" | "starred";
type Window = "7d" | "30d" | "90d";

export default function PlaygroundHistoryPage() {
  const [sessions, setSessions] = useState<PlaygroundSessionResponse[] | null>(null);
  const [error, setError] = useState("");
  const [starred, setStarred] = useState<StarredFilter>("all");
  const [modelFilter, setModelFilter] = useState<string>("");
  const [tagFilter, setTagFilter] = useState<string>("");
  const [leaderboard, setLeaderboard] = useState<PlaygroundLeaderboardResponse | null>(null);
  const [leaderboardWindow, setLeaderboardWindow] = useState<Window>("90d");

  useEffect(() => {
    let cancelled = false;
    listPlaygroundHistory({
      ...(starred === "starred" ? { starred: true } : {}),
      ...(modelFilter ? { model: modelFilter } : {}),
      ...(tagFilter ? { tag: tagFilter } : {}),
      limit: 100,
    })
      .then((data) => {
        if (!cancelled) setSessions(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [starred, modelFilter, tagFilter]);

  useEffect(() => {
    let cancelled = false;
    getPlaygroundLeaderboard(leaderboardWindow)
      .then((data) => {
        if (!cancelled) setLeaderboard(data);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [leaderboardWindow]);

  const allModels = useMemo(() => {
    if (!sessions) return [] as Array<{ id: string; name: string; count: number }>;
    const map = new Map<string, { id: string; name: string; count: number }>();
    for (const s of sessions) {
      for (const r of s.agentRuns) {
        const existing = map.get(r.modelId);
        if (existing) existing.count++;
        else map.set(r.modelId, { id: r.modelId, name: r.modelName, count: 1 });
      }
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [sessions]);

  const allTags = useMemo(() => {
    if (!sessions) return [] as Array<{ tag: string; count: number }>;
    const map = new Map<string, number>();
    for (const s of sessions) {
      for (const t of s.tags ?? []) {
        map.set(t, (map.get(t) ?? 0) + 1);
      }
    }
    return Array.from(map.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count);
  }, [sessions]);

  async function toggleStar(s: PlaygroundSessionResponse) {
    try {
      const next = await patchPlaygroundSession(s.id, { saved: !s.saved });
      setSessions((prev) =>
        prev?.map((row) => (row.id === s.id ? next : row)) ?? null,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="mdl-page playground-page">
      <Hero
        eyebrow="Playground · History"
        title={
          <>
            <em>{sessions?.length ?? "…"}</em> sessions.
          </>
        }
        lede="Filter by model, tag, or starred. The leaderboard below aggregates win-rate and average score per model."
        actions={
          <Link className="btn2 primary" href="/playground" style={{ textDecoration: "none" }}>
            + New playground
          </Link>
        }
      />

      {error && (
        <div className="mdl-err" style={{ margin: "16px 0" }}>
          <h3>Couldn&rsquo;t load sessions</h3>
          <p>{error}</p>
        </div>
      )}

      <div className="pg-hist-filters">
        <FilterChip on={starred === "all"} count={sessions?.length} onClick={() => setStarred("all")}>
          All
        </FilterChip>
        <FilterChip on={starred === "starred"} onClick={() => setStarred("starred")}>
          Starred
        </FilterChip>
        <span style={{ width: 8 }} />
        {modelFilter && (
          <FilterChip on onClick={() => setModelFilter("")}>
            model · {modelFilter} ×
          </FilterChip>
        )}
        {allModels.slice(0, 5).map((m) => (
          <FilterChip
            key={m.id}
            on={modelFilter === m.id}
            count={m.count}
            onClick={() => setModelFilter(modelFilter === m.id ? "" : m.id)}
          >
            {m.name}
          </FilterChip>
        ))}
        <span style={{ width: 8 }} />
        {tagFilter && (
          <FilterChip on onClick={() => setTagFilter("")}>
            #{tagFilter} ×
          </FilterChip>
        )}
        {allTags.slice(0, 6).map((t) => (
          <FilterChip
            key={t.tag}
            on={tagFilter === t.tag}
            count={t.count}
            onClick={() => setTagFilter(tagFilter === t.tag ? "" : t.tag)}
          >
            #{t.tag}
          </FilterChip>
        ))}
      </div>

      <div className="pg-hist-table">
        <div className="pg-hist-row head">
          <span>Session</span>
          <span>Prompt</span>
          <span>Winner</span>
          <span style={{ textAlign: "right" }}>Score</span>
          <span>Tags</span>
          <span style={{ textAlign: "right" }}>Cost</span>
          <span style={{ textAlign: "right" }}>Date</span>
          <span />
        </div>
        {sessions === null ? (
          <div style={{ padding: 18, fontFamily: "var(--mono)", fontSize: 12, color: "var(--ink-4)" }}>
            loading…
          </div>
        ) : sessions.length === 0 ? (
          <div style={{ padding: 18, fontFamily: "var(--serif)", fontStyle: "italic", color: "var(--ink-4)" }}>
            No sessions match this filter.
          </div>
        ) : (
          sessions.map((s) => {
            const winner = [...s.agentRuns]
              .filter((r) => r.score != null)
              .sort((a, b) => (b.score ?? -1) - (a.score ?? -1))[0];
            const cost = "—"; // proper cost aggregation will land with PR-2 autograder usd tracking
            return (
              <Link
                key={s.id}
                href={`/playground/${s.id}`}
                className="pg-hist-row"
                style={{ textDecoration: "none", color: "inherit" }}
              >
                <span className="id">{s.id.slice(0, 8)}</span>
                <span className="prompt">{s.title ?? s.prompt}</span>
                <span className="winner">
                  {winner ? (
                    <>
                      <span className="dot" style={{ background: pgVendor(winner.modelId) }} />
                      <span className="nm">{winner.modelName}</span>
                    </>
                  ) : (
                    <span style={{ color: "var(--ink-5)" }}>—</span>
                  )}
                </span>
                <span className="score" style={{ textAlign: "right" }}>
                  {winner?.score ?? "—"}
                </span>
                <span className="tags">
                  {s.tags.length === 0
                    ? null
                    : s.tags.slice(0, 3).map((t) => (
                        <span key={t} className="tag">
                          #{t}
                        </span>
                      ))}
                </span>
                <span className="cost" style={{ textAlign: "right" }}>
                  {cost}
                </span>
                <span className="date" style={{ textAlign: "right" }}>
                  {new Date(s.createdAt).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    void toggleStar(s);
                  }}
                  aria-label={s.saved ? "Unstar" : "Star"}
                  style={{
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    color: s.saved ? "var(--accent)" : "var(--ink-5)",
                    padding: 0,
                  }}
                >
                  <svg
                    viewBox="0 0 14 14"
                    width="14"
                    height="14"
                    fill={s.saved ? "currentColor" : "none"}
                    stroke="currentColor"
                    strokeWidth="1.4"
                  >
                    <path d="M7 1.5l1.7 3.6 3.8.5-2.8 2.7.7 3.9L7 10.4l-3.4 1.8.7-3.9L1.5 5.6l3.8-.5z" />
                  </svg>
                </button>
              </Link>
            );
          })
        )}
      </div>

      <div className="pg-leader">
        <div className="pg-leader-hd">
          <div>
            <div className="ti">
              <em style={{ color: "var(--accent)", fontStyle: "italic" }}>Model leaderboard</em>
              {" · "}last {leaderboardWindow}
            </div>
            <div style={{ fontSize: 13, color: "var(--ink-3)", marginTop: 4, maxWidth: 540, lineHeight: 1.5 }}>
              Aggregated across all scored sessions where a model competed against ≥1 peer.
            </div>
          </div>
          <select
            className="mdl-sort"
            value={leaderboardWindow}
            onChange={(e) => setLeaderboardWindow(e.target.value as Window)}
          >
            <option value="7d">last 7d</option>
            <option value="30d">last 30d</option>
            <option value="90d">last 90d</option>
          </select>
        </div>
        <div className="pg-leader-row head">
          <span>#</span>
          <span>Model</span>
          <span>Win-rate</span>
          <span style={{ textAlign: "right" }}>Avg score</span>
          <span>Sessions</span>
          <span style={{ textAlign: "right" }}></span>
        </div>
        {leaderboard === null ? (
          <div style={{ padding: 18, fontFamily: "var(--mono)", fontSize: 12, color: "var(--ink-4)" }}>
            loading…
          </div>
        ) : leaderboard.rows.length === 0 ? (
          <div style={{ padding: 22, fontFamily: "var(--serif)", fontStyle: "italic", color: "var(--ink-4)" }}>
            No scored sessions in this window yet.
          </div>
        ) : (
          leaderboard.rows.map((r, i) => (
            <div key={r.modelId} className={"pg-leader-row" + (i === 0 ? " lead" : "")}>
              <span className="rank">{i + 1}.</span>
              <div>
                <div className="nm">{r.modelName}</div>
                <div className="vendor">
                  <span
                    className="pg-vendor-dot"
                    style={{ background: pgVendor(r.modelId), width: 6, height: 6, display: "inline-block", marginRight: 5 }}
                  />
                  {r.modelId}
                </div>
              </div>
              <div className="bar2 accent">
                <span className="v">{r.winRate ?? 0}%</span>
                <span className="track">
                  <i style={{ width: `${r.winRate ?? 0}%` }} />
                </span>
              </div>
              <span
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 13,
                  fontVariantNumeric: "tabular-nums",
                  textAlign: "right",
                  color: "var(--ink)",
                }}
              >
                {r.avgScore ?? "—"}
              </span>
              <div className="breakdown">
                <span className="chip">{r.sessionsPlayed} session{r.sessionsPlayed === 1 ? "" : "s"}</span>
              </div>
              <span />
            </div>
          ))
        )}
      </div>
    </div>
  );
}

type FilterChipProps = {
  on?: boolean;
  count?: number | undefined;
  onClick: () => void;
  children: React.ReactNode;
};

function FilterChip({ on, count, onClick, children }: FilterChipProps) {
  return (
    <button
      type="button"
      className={"pg-hist-filter" + (on ? " on" : "")}
      onClick={onClick}
    >
      {children}
      {count != null && <span className="ct">{count}</span>}
    </button>
  );
}
