import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  gradePatch,
  GraderResult,
  ValidationGraderInput,
  GraderInput,
} from "./index.js";

function createMockFetch(
  responses: Array<{ status: number; content: string }>,
) {
  let callIndex = 0;
  const requests: Array<{ url: unknown; body: unknown }> = [];

  const fetchImpl = async (url: unknown, init?: RequestInit) => {
    const body = init?.body
      ? (JSON.parse(String(init.body)) as Record<string, unknown>)
      : {};
    requests.push({ url, body });

    const current = responses[callIndex++];
    if (!current) {
      return new Response("[]", { status: 500, headers: { "Content-Type": "application/json" } });
    }
    return new Response(
      JSON.stringify({
        model: "test/model",
        choices: [{ message: { content: current.content } }],
      }),
      { status: current.status, headers: { "Content-Type": "application/json" } },
    );
  };

  return { fetchImpl, requests };
}

function getRequestMessage(
  requests: Array<{ url: unknown; body: unknown }>,
  requestIndex: number,
  messageIndex: number,
): Record<string, unknown> | undefined {
  const body = requests[requestIndex]?.body as
    | Record<string, unknown>
    | undefined;
  const messages = body?.messages as unknown[] | undefined;
  const message = messages?.[messageIndex] as
    | Record<string, unknown>
    | undefined;
  return message;
}

function makeValidResult(overrides?: Partial<GraderResult>): GraderResult {
  return {
    correctness: 85,
    completeness: 80,
    safety: 90,
    score: 85,
    reasoning: "Looks good.",
    ...overrides,
  };
}

describe("gradePatch", () => {
  it("returns grading result for valid response with ValidationGraderInput", async () => {
    const result = makeValidResult({ score: 88 });
    const { fetchImpl, requests } = createMockFetch([
      { status: 200, content: JSON.stringify(result) },
    ]);

    const input: ValidationGraderInput = {
      issueTitle: "Fix bug",
      issueBody: "Something is broken",
      patchDiff: "+fix",
      baseCode: "old",
      goldCode: "new",
      apiKey: "test-key",
      modelId: "test/model",
      fetchImpl,
    };

    const output = await gradePatch(input);
    assert.equal(output.score, 88);
    assert.equal(output.correctness, 85);
    assert.equal(output.completeness, 80);
    assert.equal(output.safety, 90);
    assert.equal(output.reasoning, "Looks good.");
    assert.equal(requests.length, 1);
  });

  it("returns grading result for legacy GraderInput", async () => {
    const result = makeValidResult();
    const { fetchImpl, requests } = createMockFetch([
      { status: 200, content: JSON.stringify(result) },
    ]);

    const input: GraderInput = {
      issueDescription: "Something is broken",
      patchDiff: "+fix",
      apiKey: "test-key",
      modelId: "test/model",
      fetchImpl,
    };

    const output = await gradePatch(input);
    assert.equal(output.score, 85);
    assert.equal(requests.length, 1);

    const userContent = getRequestMessage(requests, 0, 1);
    assert.ok(
      typeof userContent?.content === "string" &&
        userContent.content.includes("Issue Description:\nSomething is broken"),
    );
    assert.ok(
      typeof userContent?.content === "string" &&
        userContent.content.includes("Patch Diff:"),
    );
  });

  it("retries once on malformed JSON", async () => {
    const result = makeValidResult();
    const { fetchImpl, requests } = createMockFetch([
      { status: 200, content: "not json" },
      { status: 200, content: JSON.stringify(result) },
    ]);

    const input: ValidationGraderInput = {
      patchDiff: "+fix",
      apiKey: "test-key",
      modelId: "test/model",
      fetchImpl,
    };

    const output = await gradePatch(input);
    assert.equal(output.score, 85);
    assert.equal(requests.length, 2);
  });

  it("retries once on invalid schema", async () => {
    const { fetchImpl, requests } = createMockFetch([
      {
        status: 200,
        content: JSON.stringify({ score: 50, reasoning: "missing fields" }),
      },
      { status: 200, content: JSON.stringify(makeValidResult()) },
    ]);

    const input: ValidationGraderInput = {
      patchDiff: "+fix",
      apiKey: "test-key",
      modelId: "test/model",
      fetchImpl,
    };

    const output = await gradePatch(input);
    assert.equal(output.score, 85);
    assert.equal(requests.length, 2);
  });

  it("throws after max attempts on persistent failure", async () => {
    const { fetchImpl, requests } = createMockFetch([
      { status: 200, content: "bad" },
      { status: 200, content: "still bad" },
    ]);

    const input: ValidationGraderInput = {
      patchDiff: "+fix",
      apiKey: "test-key",
      modelId: "test/model",
      fetchImpl,
    };

    await assert.rejects(() => gradePatch(input), /malformed JSON/);
    assert.equal(requests.length, 2);
  });

  it("retries on API error and succeeds", async () => {
    const { fetchImpl, requests } = createMockFetch([
      {
        status: 500,
        content: JSON.stringify({ error: { message: "Server error" } }),
      },
      { status: 200, content: JSON.stringify(makeValidResult()) },
    ]);

    const input: ValidationGraderInput = {
      patchDiff: "+fix",
      apiKey: "test-key",
      modelId: "test/model",
      fetchImpl,
    };

    const output = await gradePatch(input);
    assert.equal(output.score, 85);
    assert.equal(requests.length, 2);
  });

  it("throws after max attempts on persistent API errors", async () => {
    const { fetchImpl, requests } = createMockFetch([
      {
        status: 500,
        content: JSON.stringify({ error: { message: "Server error" } }),
      },
      {
        status: 500,
        content: JSON.stringify({ error: { message: "Still down" } }),
      },
    ]);

    const input: ValidationGraderInput = {
      patchDiff: "+fix",
      apiKey: "test-key",
      modelId: "test/model",
      fetchImpl,
    };

    await assert.rejects(() => gradePatch(input), /Grader API error/);
    assert.equal(requests.length, 2);
  });

  it("includes base and gold code in prompt when provided", async () => {
    const { fetchImpl, requests } = createMockFetch([
      { status: 200, content: JSON.stringify(makeValidResult()) },
    ]);

    const input: ValidationGraderInput = {
      issueTitle: "Bug",
      patchDiff: "+fix",
      baseCode: "old code",
      goldCode: "new code",
      apiKey: "test-key",
      modelId: "test/model",
      fetchImpl,
    };

    await gradePatch(input);
    const userContent = getRequestMessage(requests, 0, 1);
    assert.ok(
      typeof userContent?.content === "string" &&
        userContent.content.includes("Base Code (before fix):"),
    );
    assert.ok(
      typeof userContent?.content === "string" &&
        userContent.content.includes("old code"),
    );
    assert.ok(
      typeof userContent?.content === "string" &&
        userContent.content.includes("Gold Code (expected fix):"),
    );
    assert.ok(
      typeof userContent?.content === "string" &&
        userContent.content.includes("new code"),
    );
  });

  it("does not include base/gold sections for legacy input", async () => {
    const { fetchImpl, requests } = createMockFetch([
      { status: 200, content: JSON.stringify(makeValidResult()) },
    ]);

    const input: GraderInput = {
      issueDescription: "Something is broken",
      patchDiff: "+fix",
      apiKey: "test-key",
      modelId: "test/model",
      fetchImpl,
    };

    await gradePatch(input);
    const userContent = getRequestMessage(requests, 0, 1);
    assert.ok(
      typeof userContent?.content === "string" &&
        !userContent.content.includes("Base Code"),
    );
    assert.ok(
      typeof userContent?.content === "string" &&
        !userContent.content.includes("Gold Code"),
    );
  });

  it("includes the rubric in the system prompt", async () => {
    const { fetchImpl, requests } = createMockFetch([
      { status: 200, content: JSON.stringify(makeValidResult()) },
    ]);

    const input: ValidationGraderInput = {
      issueTitle: "Bug",
      patchDiff: "+fix",
      apiKey: "test-key",
      modelId: "test/model",
      fetchImpl,
    };

    await gradePatch(input);
    const systemContent = getRequestMessage(requests, 0, 0);
    assert.ok(
      typeof systemContent?.content === "string" &&
        systemContent.content.includes("Correctness"),
    );
    assert.ok(
      typeof systemContent?.content === "string" &&
        systemContent.content.includes("Completeness"),
    );
    assert.ok(
      typeof systemContent?.content === "string" &&
        systemContent.content.includes("Safety"),
    );
    assert.ok(
      typeof systemContent?.content === "string" &&
        systemContent.content.includes("0-100"),
    );
  });
});
