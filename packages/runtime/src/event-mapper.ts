import type { AgentEventKind } from "./event-stream.js";

export type MappedEvent = {
  kind: AgentEventKind;
  payload: Record<string, unknown>;
  /** Convenience: text-delta payloads expose the delta string here so callers can accumulate output without re-parsing. */
  textDelta?: string;
};

/**
 * Translate a Pi SDK lifecycle event into the normalized AppendEventBody shape.
 * Returns `null` for events we deliberately drop (agent_*, message_start/end,
 * compaction_*, queue_update, etc. — anything that isn't user-relevant).
 */
export function mapPiSdkEvent(event: unknown): MappedEvent | null {
  if (!isRecord(event)) return null;
  const type = stringValue(event.type);

  if (type === "message_update" && isRecord(event.assistantMessageEvent)) {
    const inner = event.assistantMessageEvent;
    const innerType = stringValue(inner.type);
    if (innerType === "text_delta") {
      const delta = stringValue(inner.delta) ?? "";
      if (!delta) return null;
      return { kind: "assistant_text_delta", payload: { delta }, textDelta: delta };
    }
    return null;
  }

  if (type === "tool_execution_start") {
    return {
      kind: "tool_call_started",
      payload: scrub({
        toolName: stringValue(event.toolName) ?? "unknown",
        toolCallId: stringValue(event.toolCallId),
        arguments: event.args ?? event.arguments,
      }),
    };
  }
  if (type === "tool_execution_update") {
    return {
      kind: "tool_call_delta",
      payload: scrub({
        toolName: stringValue(event.toolName),
        toolCallId: stringValue(event.toolCallId),
        partialResult: event.partialResult,
      }),
    };
  }
  if (type === "tool_execution_end") {
    return {
      kind: "tool_call_finished",
      payload: scrub({
        toolName: stringValue(event.toolName) ?? "unknown",
        toolCallId: stringValue(event.toolCallId),
        result: event.result,
        isError: Boolean(event.isError),
      }),
    };
  }

  return null;
}

export type TurnCompleteEvent = {
  type: "pilab_turn_complete";
  turn?: number;
  status?: string;
  message?: string;
};

export function isTurnCompleteEvent(value: unknown): value is TurnCompleteEvent {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<string, unknown>).type === "pilab_turn_complete"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function scrub(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}
