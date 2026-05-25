"use client";

import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type {
  PlaygroundAgentRunResponse,
  PlaygroundEventResponse,
} from "../../lib/api";
import { pgVendor, pgVendorName } from "../../lib/playground-vendor";
import { PreviewTile } from "./PreviewTile";
import { AgentMoreMenu } from "./AgentMoreMenu";

type TextItem = { kind: "text"; key: string; text: string };
type ToolItem = {
  kind: "tool";
  key: string;
  toolCallId: string;
  toolName: string;
  arguments: unknown;
  result: unknown;
  isError: boolean;
  finished: boolean;
  startedAt?: number;
  finishedAt?: number;
};
type ToolGroupItem = {
  kind: "tool-group";
  key: string;
  toolName: string;
  scope: string | null;
  children: ToolItem[];
};
type StatusItem = { kind: "status"; key: string; status: string };
type ErrorItem = { kind: "error"; key: string; message: string };
type UserItem = { kind: "user"; key: string; text: string };

type TranscriptItem =
  | TextItem
  | ToolItem
  | ToolGroupItem
  | StatusItem
  | ErrorItem
  | UserItem;

type AgentPanelProps = {
  agentRun: PlaygroundAgentRunResponse;
  events: PlaygroundEventResponse[];
  index: number;
  showPreview?: boolean;
  onStop?: () => void;
  onSendFollowUp?: (text: string) => Promise<void>;
  sandboxReleased?: boolean;
  compact?: boolean;
};

export function AgentPanel({
  agentRun,
  events,
  index,
  showPreview = false,
  onStop,
  onSendFollowUp,
  sandboxReleased = false,
  compact = false,
}: AgentPanelProps) {
  const transcript = useMemo(() => groupTranscript(buildTranscript(events)), [events]);
  const isLive = agentRun.status === "running" || agentRun.status === "preparing";
  const lastItem = transcript[transcript.length - 1];
  const showCursor = isLive && lastItem?.kind === "text";

  const port = derivePortFromAppUrl(agentRun.appUrl) ?? 30000 + index;
  const vendorSlug = pgVendorName(agentRun.modelId);
  const statusText = describeStatus(agentRun.status);

  return (
    <div className="pg-agent">
      <div className="pg-agent-hd">
        <div className="left">
          <span className={"pg-status-dot " + agentRun.status} />
          <div>
            <div className="nm">{agentRun.modelName}</div>
            {!compact && (
              <div className="vendor">
                {vendorSlug} · port {port}
              </div>
            )}
          </div>
        </div>
        <div className="left" style={{ justifyContent: "center" }}>
          <span className="status-text">{statusText}</span>
        </div>
        <div className="right">
          {agentRun.appUrl && (
            <a
              className="pg-open-chip"
              href={agentRun.appUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              <svg
                viewBox="0 0 12 12"
                width="10"
                height="10"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                aria-hidden="true"
              >
                <path d="M5 2H2v8h8V7M7 2h3v3M5 7l5-5" />
              </svg>
              <span>open app</span>
            </a>
          )}
          <AgentMoreMenu
            canStop={isLive}
            {...(onStop ? { onStop } : {})}
            onCopyTranscript={() => copyTranscript(transcript)}
          />
        </div>
      </div>

      {showPreview && agentRun.appUrl && (
        <div style={{ padding: "12px 14px 0" }}>
          <PreviewTile url={agentRun.appUrl} />
        </div>
      )}

      <div className="pg-tx">
        {transcript.length === 0 ? (
          <p
            style={{
              color: "var(--ink-4)",
              fontStyle: "italic",
              fontSize: 13,
              fontFamily: "var(--serif)",
              margin: 0,
            }}
          >
            {agentRun.status === "queued"
              ? "Waiting to start…"
              : agentRun.status === "preparing"
                ? "Setting up sandbox…"
                : "No events yet"}
          </p>
        ) : (
          transcript.map((item, idx) => {
            const isLastTextItem =
              idx === transcript.length - 1 && item.kind === "text" && showCursor;
            return renderItem(item, isLastTextItem);
          })
        )}
      </div>

      {onSendFollowUp && (
        <FollowUpInput
          agentRunId={agentRun.id}
          status={agentRun.status}
          sandboxReleased={sandboxReleased}
          onSend={onSendFollowUp}
        />
      )}
    </div>
  );
}

function FollowUpInput({
  agentRunId,
  status,
  sandboxReleased,
  onSend,
}: {
  agentRunId: string;
  status: string;
  sandboxReleased: boolean;
  onSend: (text: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const firstTurnInFlight = status === "queued" || status === "preparing";
  const followUpInFlight = status === "running";
  const disabled = sandboxReleased || firstTurnInFlight || followUpInFlight;
  const placeholder = sandboxReleased
    ? "Sandbox released — start a new playground to continue"
    : firstTurnInFlight
      ? "Agent is starting up…"
      : followUpInFlight
        ? "Agent is replying…"
        : "Follow up — Enter to send, Shift+Enter for newline";

  async function submit() {
    const text = draft.trim();
    if (!text || disabled) return;
    setSending(true);
    setError(null);
    try {
      await onSend(text);
      setDraft("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(
        message === "sandbox_released"
          ? "Sandbox was released — your follow-up can't be delivered."
          : message,
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="pg-followup" data-agent={agentRunId}>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value.slice(0, 4000))}
        placeholder={placeholder}
        disabled={disabled || sending}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void submit();
          }
        }}
        rows={1}
      />
      <div className="pg-followup-actions">
        <span className="pg-followup-counter">{draft.length} / 4000</span>
        <button
          type="button"
          className="btn2 primary sm"
          disabled={disabled || sending || draft.trim().length === 0}
          onClick={() => void submit()}
        >
          {sending ? "Sending…" : "Send"}
        </button>
      </div>
      {error && <div className="pg-followup-err">{error}</div>}
    </div>
  );
}

function describeStatus(status: PlaygroundAgentRunResponse["status"]): string {
  switch (status) {
    case "queued":
      return "queued";
    case "preparing":
      return "preparing";
    case "running":
      return "running";
    case "succeeded":
      return "done";
    case "failed":
      return "failed";
    default:
      return status;
  }
}

function derivePortFromAppUrl(url: string | null): number | null {
  if (!url) return null;
  const match = url.match(/-(\d{4,5})\./);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isInteger(n) ? n : null;
}

function renderItem(item: TranscriptItem, withCursor: boolean) {
  if (item.kind === "text") {
    return (
      <div key={item.key} className="pg-tx-text">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            a: (props) => <a {...props} target="_blank" rel="noopener noreferrer" />,
          }}
        >
          {item.text}
        </ReactMarkdown>
        {withCursor && <span className="caret" />}
      </div>
    );
  }
  if (item.kind === "tool") {
    return (
      <div
        key={item.key}
        className={
          "pg-tx-tool" +
          (item.finished ? " done" : "") +
          (item.isError ? " error" : "")
        }
      >
        <span className="glyph" />
        <span>
          {item.toolName}
          {summarizeArgs(item) && (
            <>
              {" "}
              <span className="arg">{summarizeArgs(item)}</span>
            </>
          )}
        </span>
        <span className="ms">
          {item.finished
            ? formatDuration(item.startedAt, item.finishedAt)
            : "running…"}
        </span>
      </div>
    );
  }
  if (item.kind === "tool-group") {
    const totalChildren = item.children.length;
    const failed = item.children.some((c) => c.isError);
    return (
      <details key={item.key} className="pg-tx-tool group done" style={{ display: "block" }}>
        <summary
          style={{
            display: "grid",
            gridTemplateColumns: "14px 1fr auto",
            gap: 10,
            alignItems: "center",
            cursor: "pointer",
            listStyle: "none",
          }}
        >
          <span className="glyph" style={failed ? { background: "var(--err)" } : undefined} />
          <span>
            {item.toolName}{" "}
            <span className="arg">
              {item.scope ? `${item.scope} · ` : ""}
              {totalChildren}× calls
            </span>
            <span className="badge">grouped</span>
          </span>
          <span className="ms">{totalChildren}</span>
        </summary>
        <div
          style={{
            marginTop: 6,
            display: "flex",
            flexDirection: "column",
            gap: 4,
            paddingLeft: 24,
          }}
        >
          {item.children.map((child) => (
            <div
              key={child.key}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr auto",
                gap: 10,
                fontFamily: "var(--mono)",
                fontSize: 11,
                color: "var(--ink-3)",
              }}
            >
              <span>
                <span style={{ color: "var(--accent)" }}>$</span>{" "}
                {summarizeArgs(child) || child.toolName}
              </span>
              <span
                style={{
                  color: child.isError ? "var(--err)" : "var(--ink-4)",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {child.finished
                  ? formatDuration(child.startedAt, child.finishedAt)
                  : "running…"}
              </span>
            </div>
          ))}
        </div>
      </details>
    );
  }
  if (item.kind === "status") {
    return (
      <div key={item.key} className="pg-tx-status">
        {item.status}
      </div>
    );
  }
  if (item.kind === "user") {
    return (
      <div key={item.key} className="pg-tx-user">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            a: (props) => <a {...props} target="_blank" rel="noopener noreferrer" />,
          }}
        >
          {item.text}
        </ReactMarkdown>
      </div>
    );
  }
  return (
    <div key={item.key} className="pg-tx-err">
      {item.message}
    </div>
  );
}

function summarizeArgs(item: ToolItem): string {
  const args = item.arguments;
  if (args == null) return "";
  if (typeof args === "string") {
    return truncate(args, 72);
  }
  if (typeof args === "object") {
    const a = args as Record<string, unknown>;
    const path = stringOrUndef(a.path) ?? stringOrUndef(a.filename) ?? stringOrUndef(a.file);
    const cmd = stringOrUndef(a.command) ?? stringOrUndef(a.cmd);
    const pattern = stringOrUndef(a.pattern) ?? stringOrUndef(a.regex);
    if (cmd) return truncate(cmd, 72);
    if (path) return truncate(path, 72);
    if (pattern) return truncate(pattern, 72);
    try {
      return truncate(JSON.stringify(args), 72);
    } catch {
      return "";
    }
  }
  return "";
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}

function stringOrUndef(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function formatDuration(start: number | undefined, end: number | undefined): string {
  if (start == null || end == null || end < start) return "—";
  const ms = end - start;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

function copyTranscript(items: TranscriptItem[]) {
  const text = items
    .map((item) => {
      if (item.kind === "text") return item.text;
      if (item.kind === "tool") return `$ ${item.toolName} ${summarizeArgs(item)}`;
      if (item.kind === "tool-group")
        return item.children
          .map((c) => `$ ${c.toolName} ${summarizeArgs(c)}`)
          .join("\n");
      if (item.kind === "status") return `· ${item.status}`;
      if (item.kind === "error") return `[error] ${item.message}`;
      if (item.kind === "user") return `> ${item.text}`;
      return "";
    })
    .filter(Boolean)
    .join("\n\n");
  void navigator.clipboard?.writeText(text);
}

// ── Transcript builder ────────────────────────────────────────────────────

function buildTranscript(events: PlaygroundEventResponse[]): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  const toolIndex = new Map<string, number>();
  let currentText: TextItem | null = null;

  const flushText = () => {
    if (currentText && currentText.text.length > 0) items.push(currentText);
    currentText = null;
  };

  for (const ev of events) {
    const payload = (ev.payload ?? {}) as Record<string, unknown>;
    const eventTime = parseTimestamp(ev);

    if (ev.kind === "assistant_text_delta") {
      const delta = typeof payload.delta === "string" ? payload.delta : "";
      if (!currentText) currentText = { kind: "text", key: `text-${ev.id}`, text: "" };
      currentText.text += delta;
      continue;
    }

    if (ev.kind === "tool_call_started") {
      const rawToolName = payload.toolName;
      if (rawToolName === undefined || rawToolName === "unknown") continue;
      flushText();
      const toolCallId = String(payload.toolCallId ?? ev.id);
      const item: ToolItem = {
        kind: "tool",
        key: `tool-${toolCallId}`,
        toolCallId,
        toolName: String(rawToolName),
        arguments: payload.arguments,
        result: undefined,
        isError: false,
        finished: false,
        ...(eventTime !== undefined ? { startedAt: eventTime } : {}),
      };
      toolIndex.set(toolCallId, items.length);
      items.push(item);
      continue;
    }

    if (ev.kind === "tool_call_delta") {
      const toolCallId = String(payload.toolCallId ?? "");
      const idx = toolIndex.get(toolCallId);
      if (idx !== undefined) {
        const existing = items[idx] as ToolItem;
        if (existing.arguments === undefined && payload.arguments !== undefined) {
          existing.arguments = payload.arguments;
        }
      }
      continue;
    }

    if (ev.kind === "tool_call_finished") {
      const toolCallId = String(payload.toolCallId ?? "");
      const idx = toolIndex.get(toolCallId);
      if (idx !== undefined) {
        const existing = items[idx] as ToolItem;
        existing.result = payload.result;
        existing.isError = Boolean(payload.isError);
        existing.finished = true;
        if (eventTime !== undefined) existing.finishedAt = eventTime;
      } else {
        flushText();
        items.push({
          kind: "tool",
          key: `tool-${ev.id}`,
          toolCallId: toolCallId || ev.id,
          toolName: String(payload.toolName ?? "unknown"),
          arguments: undefined,
          result: payload.result,
          isError: Boolean(payload.isError),
          finished: true,
          ...(eventTime !== undefined ? { finishedAt: eventTime } : {}),
        });
      }
      continue;
    }

    if (ev.kind === "status") {
      const status = String(payload.status ?? "");
      if (
        status === "agent_start" ||
        status === "agent_end" ||
        status === "turn_start" ||
        status === "turn_end" ||
        status === "message_start" ||
        status === "message_end" ||
        status === "queue_update" ||
        status === "compaction_start" ||
        status === "compaction_end" ||
        status === "auto_retry_start" ||
        status === "auto_retry_end"
      ) {
        continue;
      }
      flushText();
      const last = items[items.length - 1];
      if (last?.kind === "status" && last.status === status) continue;
      items.push({ kind: "status", key: `status-${ev.id}`, status });
      continue;
    }

    if (ev.kind === "error") {
      flushText();
      items.push({
        kind: "error",
        key: `error-${ev.id}`,
        message: String(payload.error ?? payload.message ?? "unknown error"),
      });
      continue;
    }

    if (ev.kind === "url_resolved") {
      flushText();
      items.push({
        kind: "status",
        key: `url-${ev.id}`,
        status: `app at ${String(payload.url ?? "")}`,
      });
      continue;
    }

    if (ev.kind === "user_follow_up") {
      flushText();
      items.push({
        kind: "user",
        key: `user-${ev.id}`,
        text: String(payload.text ?? ""),
      });
      continue;
    }

    // turn_complete is observed by the worker but doesn't render in the UI.
    if (ev.kind === "turn_complete") {
      continue;
    }
  }

  flushText();
  return items;
}

function parseTimestamp(ev: PlaygroundEventResponse): number | undefined {
  if (ev.timestamp) {
    const d = new Date(ev.timestamp).getTime();
    if (Number.isFinite(d)) return d;
  }
  return undefined;
}

// ── Tool-call grouping ────────────────────────────────────────────────────
//
// Collapse ≥2 consecutive tool calls that either:
// - share the same `toolName` (e.g. a bash chain), OR
// - mutate the same target file path (multiple write/edit of the same file).
// The grouping renders as one `pg-tx-tool group` with a <details> revealing each.

function toolScope(item: ToolItem): string | null {
  const args = item.arguments;
  if (args && typeof args === "object" && !Array.isArray(args)) {
    const a = args as Record<string, unknown>;
    return (
      stringOrUndef(a.path) ??
      stringOrUndef(a.filename) ??
      stringOrUndef(a.file) ??
      null
    );
  }
  return null;
}

function groupTranscript(items: TranscriptItem[]): TranscriptItem[] {
  const out: TranscriptItem[] = [];
  let i = 0;
  while (i < items.length) {
    const cur = items[i];
    if (!cur || cur.kind !== "tool") {
      if (cur) out.push(cur);
      i++;
      continue;
    }
    // Look ahead for a consecutive group.
    let j = i + 1;
    const scope = toolScope(cur);
    while (j < items.length) {
      const next = items[j];
      if (!next || next.kind !== "tool") break;
      const sameName = next.toolName === cur.toolName;
      const sameScope = scope != null && toolScope(next) === scope;
      if (!sameName && !sameScope) break;
      j++;
    }
    const runLength = j - i;
    if (runLength >= 2) {
      const children = items.slice(i, j).filter((it): it is ToolItem => it.kind === "tool");
      out.push({
        kind: "tool-group",
        key: `group-${cur.key}`,
        toolName: cur.toolName,
        scope: scope,
        children,
      });
    } else {
      out.push(cur);
    }
    i = j;
  }
  return out;
}
