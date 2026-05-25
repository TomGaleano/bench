import { test } from "node:test";
import assert from "node:assert/strict";
import { createEventStream } from "./event-stream.js";

type FakeRequest = { url: string; body: unknown };

function makeStream(captured: FakeRequest[]) {
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : (input as URL).toString();
    const body = init?.body ? JSON.parse(init.body as string) : null;
    captured.push({ url, body });
    return new Response("ok", { status: 200 });
  };
  return createEventStream({
    apiBaseUrl: "https://api.test",
    eventsPath: "/playground/:sessionId/events",
    runUpdatePath: "/playground/:sessionId/runs/:agentRunId",
    sessionId: "sess-1",
    agentRunId: "agent-A",
    loggerTag: "test",
    fetchImpl: fakeFetch,
  });
}

test("event seq increments per stream", async () => {
  const captured: FakeRequest[] = [];
  const stream = makeStream(captured);
  await stream.postEvent("status", { phase: "preparing" });
  await stream.postEvent("assistant_text_delta", { delta: "hi" });
  await stream.postEvent("turn_complete", { turn: 1 });

  assert.equal(captured.length, 3);
  assert.equal(captured[0]!.url, "https://api.test/playground/sess-1/events");
  const bodies = captured.map((c) => c.body as { seq: number; kind: string; agentRunId: string });
  assert.deepEqual(bodies.map((b) => b.seq), [1, 2, 3]);
  assert.equal(bodies[0]!.agentRunId, "agent-A");
  assert.equal(bodies[1]!.kind, "assistant_text_delta");
});

test("postRunUpdate hits run-update URL with substitutions", async () => {
  const captured: FakeRequest[] = [];
  const stream = makeStream(captured);
  await stream.postRunUpdate({ status: "running", sandboxId: "sbx-1" });
  assert.equal(captured[0]!.url, "https://api.test/playground/sess-1/runs/agent-A");
  assert.deepEqual(captured[0]!.body, { status: "running", sandboxId: "sbx-1" });
});

test("non-OK responses don't throw", async () => {
  const errFetch: typeof fetch = async () => new Response("nope", { status: 500 });
  const stream = createEventStream({
    apiBaseUrl: "https://api.test",
    eventsPath: "/x/:sessionId/events",
    runUpdatePath: "/x/:sessionId/runs/:agentRunId",
    sessionId: "s",
    agentRunId: "a",
    fetchImpl: errFetch,
  });
  await stream.postEvent("error", { error: "oops" });
  // No throw; we just log. Test passes if we get here.
});
