"use client";

import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { PlaygroundAgentRunResponse, PlaygroundEventResponse } from "../../lib/api";

type AgentPanelProps = {
  agentRun: PlaygroundAgentRunResponse;
  events: PlaygroundEventResponse[];
};

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
};
type StatusItem = { kind: "status"; key: string; status: string };
type ErrorItem = { kind: "error"; key: string; message: string };
type TranscriptItem = TextItem | ToolItem | StatusItem | ErrorItem;

const STATUS_COLORS: Record<string, string> = {
  running: "var(--accent)",
  succeeded: "#22c55e",
  failed: "#ef4444",
  preparing: "#f59e0b",
  queued: "var(--ink-4)",
};

export function AgentPanel({ agentRun, events }: AgentPanelProps) {
  const transcript = useMemo(() => buildTranscript(events), [events]);
  const isLive = agentRun.status === "running" || agentRun.status === "preparing";
  const lastItem = transcript[transcript.length - 1];
  const showCursor = isLive && lastItem?.kind === "text";

  return (
    <div className="card2" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div className="card2-hd">
        <span className="card2-ti">
          {agentRun.modelName}
          <span
            style={{
              display: "inline-block",
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: STATUS_COLORS[agentRun.status] ?? "var(--ink-4)",
              marginLeft: 8,
            }}
          />
        </span>
        <span style={{ color: "var(--ink-4)", fontFamily: "var(--mono)", fontSize: 11 }}>
          {agentRun.status}
        </span>
      </div>

      {agentRun.appUrl && (
        <div style={{ padding: "0 16px 8px" }}>
          <a
            href={agentRun.appUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn2"
            style={{ fontSize: 12 }}
          >
            Open app ↗
          </a>
        </div>
      )}

      <div className="playground-transcript" style={{ flex: 1, overflow: "auto", padding: "8px 16px" }}>
        {transcript.length === 0 ? (
          <p style={{ color: "var(--ink-4)", fontStyle: "italic", fontSize: 13 }}>
            {agentRun.status === "queued"
              ? "Waiting to start…"
              : agentRun.status === "preparing"
                ? "Setting up sandbox…"
                : "No events yet"}
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {transcript.map((item, idx) => {
              const isLastTextItem = idx === transcript.length - 1 && item.kind === "text" && showCursor;
              return renderItem(item, isLastTextItem);
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function renderItem(item: TranscriptItem, withCursor: boolean) {
  if (item.kind === "text") {
    return (
      <div key={item.key} className="playground-md" style={{ color: "var(--ink-1)" }}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            a: (props) => <a {...props} target="_blank" rel="noopener noreferrer" />,
            pre: (props) => (
              <pre
                {...props}
                style={{
                  background: "var(--surface-2, rgba(0,0,0,0.04))",
                  padding: 8,
                  borderRadius: 6,
                  overflow: "auto",
                  fontSize: 12,
                }}
              />
            ),
            code: (props) => {
              const { children, className, ...rest } = props as {
                children?: React.ReactNode;
                className?: string;
              };
              const isBlock = className?.includes("language-");
              if (isBlock) {
                return (
                  <code {...rest} className={className}>
                    {children}
                  </code>
                );
              }
              return (
                <code
                  {...rest}
                  style={{
                    background: "var(--surface-2, rgba(0,0,0,0.06))",
                    padding: "1px 5px",
                    borderRadius: 4,
                    fontSize: "0.92em",
                    fontFamily: "var(--mono)",
                  }}
                >
                  {children}
                </code>
              );
            },
          }}
        >
          {item.text}
        </ReactMarkdown>
        {withCursor && <BlinkingCursor />}
      </div>
    );
  }
  if (item.kind === "tool") {
    return (
      <details
        key={item.key}
        className="playground-tool"
        style={{
          alignSelf: "flex-start",
          maxWidth: "100%",
        }}
      >
        <summary
          style={{
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "3px 10px 3px 6px",
            borderRadius: 999,
            background: "var(--surface-2, rgba(0,0,0,0.05))",
            color: item.isError ? "#ef4444" : "var(--ink-2)",
            fontFamily: "var(--mono)",
            fontSize: 12,
            listStyle: "none",
            userSelect: "none",
          }}
        >
          <span style={{ opacity: 0.55, fontSize: 10 }}>▸</span>
          <ToolGlyph isError={item.isError} finished={item.finished} />
          <span style={{ fontWeight: 600 }}>{item.toolName}</span>
          {!item.finished && (
            <span style={{ color: "var(--ink-4)", fontSize: 10 }}>running…</span>
          )}
        </summary>
        <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 6 }}>
          {item.arguments !== undefined && <Block label="arguments" value={item.arguments} />}
          {item.finished && item.result !== undefined && <Block label="result" value={item.result} />}
        </div>
      </details>
    );
  }
  if (item.kind === "status") {
    return (
      <div
        key={item.key}
        style={{
          alignSelf: "flex-start",
          color: "var(--ink-4)",
          fontFamily: "var(--mono)",
          fontSize: 10,
          textTransform: "uppercase",
          letterSpacing: 0.5,
          opacity: 0.7,
        }}
      >
        · {item.status}
      </div>
    );
  }
  return (
    <div
      key={item.key}
      style={{
        color: "#ef4444",
        background: "rgba(239, 68, 68, 0.08)",
        padding: "4px 8px",
        borderRadius: 4,
        fontFamily: "var(--mono)",
        fontSize: 12,
        whiteSpace: "pre-wrap",
      }}
    >
      Error: {item.message}
    </div>
  );
}

function ToolGlyph({ isError, finished }: { isError: boolean; finished: boolean }) {
  const color = isError ? "#ef4444" : finished ? "var(--accent)" : "var(--ink-4)";
  return (
    <span
      style={{
        display: "inline-block",
        width: 12,
        height: 12,
        borderRadius: 3,
        background: color,
        opacity: 0.85,
        flex: "none",
      }}
      aria-hidden="true"
    />
  );
}

function Block({ label, value }: { label: string; value: unknown }) {
  const text = formatValue(value);
  return (
    <div>
      <div style={{ color: "var(--ink-4)", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5 }}>
        {label}
      </div>
      <pre
        style={{
          margin: 0,
          marginTop: 2,
          whiteSpace: "pre-wrap",
          fontSize: 11,
          color: "var(--ink-2)",
          maxHeight: 220,
          overflow: "auto",
          background: "var(--surface-2, rgba(0,0,0,0.04))",
          padding: 6,
          borderRadius: 4,
        }}
      >
        {text}
      </pre>
    </div>
  );
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") {
    if (value.length > 0 && (value.trim().startsWith("{") || value.trim().startsWith("["))) {
      try {
        return JSON.stringify(JSON.parse(value), null, 2);
      } catch {
        return value;
      }
    }
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function BlinkingCursor() {
  return (
    <span
      style={{
        display: "inline-block",
        width: 8,
        height: "1em",
        marginLeft: 2,
        background: "var(--accent)",
        animation: "playgroundCursorBlink 1s steps(2, start) infinite",
        verticalAlign: "text-bottom",
      }}
    >
      <style>{`@keyframes playgroundCursorBlink { to { visibility: hidden; } }`}</style>
    </span>
  );
}

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

    if (ev.kind === "assistant_text_delta") {
      const delta = typeof payload.delta === "string" ? payload.delta : "";
      if (!currentText) currentText = { kind: "text", key: `text-${ev.id}`, text: "" };
      currentText.text += delta;
      continue;
    }

    if (ev.kind === "tool_call_started") {
      // Skip the "unknown" tool calls historical sessions persisted from
      // message_update.toolcall_start (those don't carry a real name).
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
        });
      }
      continue;
    }

    if (ev.kind === "status") {
      const status = String(payload.status ?? "");
      // Drop Pi-SDK lifecycle noise persisted by older worker versions.
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
  }

  flushText();
  return items;
}
