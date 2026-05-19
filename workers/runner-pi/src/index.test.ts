import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizePiSdkEvent } from "./index.js";

describe("normalizePiSdkEvent", () => {
  it("maps assistant text deltas", () => {
    const mapped = normalizePiSdkEvent({
      type: "message_update",
      assistantMessageEvent: {
        type: "text_delta",
        delta: "hello",
      },
    });

    assert.equal(mapped?.event.kind, "assistant_text_delta");
    assert.equal(mapped?.textDelta, "hello");
  });

  it("maps assistant tool calls", () => {
    const mapped = normalizePiSdkEvent({
      type: "message_update",
      assistantMessageEvent: {
        type: "toolcall_start",
        toolName: "read",
        toolCallId: "tool-1",
      },
    });

    assert.equal(mapped?.event.kind, "tool_call_started");
    assert.deepEqual(mapped?.event.payload, {
      toolName: "read",
      toolCallId: "tool-1",
    });
  });

  it("maps lifecycle events to status", () => {
    const mapped = normalizePiSdkEvent({ type: "agent_start" });

    assert.equal(mapped?.event.kind, "status");
    assert.deepEqual(mapped?.event.payload, { status: "agent_start" });
  });
});
