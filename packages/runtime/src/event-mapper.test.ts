import { test } from "node:test";
import assert from "node:assert/strict";
import { isTurnCompleteEvent, mapPiSdkEvent } from "./event-mapper.js";

test("message_update + text_delta becomes assistant_text_delta", () => {
  const mapped = mapPiSdkEvent({
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", delta: "Hello" },
  });
  assert.ok(mapped);
  assert.equal(mapped!.kind, "assistant_text_delta");
  assert.equal(mapped!.textDelta, "Hello");
  assert.deepEqual(mapped!.payload, { delta: "Hello" });
});

test("empty text_delta is dropped", () => {
  const mapped = mapPiSdkEvent({
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", delta: "" },
  });
  assert.equal(mapped, null);
});

test("tool_execution_start maps to tool_call_started", () => {
  const mapped = mapPiSdkEvent({
    type: "tool_execution_start",
    toolName: "bash",
    toolCallId: "tc-1",
    args: { command: "ls" },
  });
  assert.equal(mapped?.kind, "tool_call_started");
  assert.deepEqual(mapped?.payload, {
    toolName: "bash",
    toolCallId: "tc-1",
    arguments: { command: "ls" },
  });
});

test("tool_execution_end maps to tool_call_finished with isError", () => {
  const mapped = mapPiSdkEvent({
    type: "tool_execution_end",
    toolName: "bash",
    toolCallId: "tc-1",
    result: "ok",
    isError: false,
  });
  assert.equal(mapped?.kind, "tool_call_finished");
  assert.equal(mapped?.payload.isError, false);
});

test("unknown event types are dropped", () => {
  assert.equal(mapPiSdkEvent({ type: "agent_thinking" }), null);
  assert.equal(mapPiSdkEvent({ type: "message_start" }), null);
  assert.equal(mapPiSdkEvent({ type: "compaction_started" }), null);
});

test("isTurnCompleteEvent recognizes the harness sentinel", () => {
  assert.equal(isTurnCompleteEvent({ type: "pilab_turn_complete", turn: 2 }), true);
  assert.equal(isTurnCompleteEvent({ type: "other" }), false);
  assert.equal(isTurnCompleteEvent(null), false);
});
