import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createOpenRouterTestBuilder,
  parseProposedTestBuilderCandidate,
} from "./openrouter-test-builder.js";

describe("OpenRouter test-builder parser", () => {
  it("accepts proposed fail/pass test specs and adds the local schema version", () => {
    const candidate = parseProposedTestBuilderCandidate({
      proposedTests: [
        {
          name: "server component rejects classes",
          kind: "fail_to_pass",
          filePath: "packages/react-server/src/__tests__/ReactFlight-test.js",
          testCommand: "yarn test ReactFlight",
          expectedFailureMode: "Class instances are accepted before the fix.",
          expectedPassMode: "Class instances are rejected after the fix.",
          content: "test('server component rejects classes', () => {});",
          rationale: "The issue and PR both describe simple-object enforcement.",
        },
        {
          name: "plain object payload still works",
          kind: "pass_to_pass",
          filePath: "packages/react-server/src/__tests__/ReactFlightPlainObject-test.js",
          testCommand: "yarn test ReactFlight",
          content: "test('plain object payload still works', () => {});",
          rationale: "The fix should preserve valid plain object serialization.",
        },
      ],
      notes: ["Proposed only; execution validation is still required."],
    });

    assert.equal(candidate.schemaVersion, "pilab.test-builder.proposal.v1");
    assert.equal(candidate.proposedTests.length, 2);
    assert.equal(candidate.proposedTests[0]?.kind, "fail_to_pass");
    assert.equal(candidate.proposedTests[1]?.kind, "pass_to_pass");
  });

  it("retries once when the model returns malformed JSON", async () => {
    const validContent = JSON.stringify({
      proposedTests: [
        {
          name: "example regression",
          kind: "fail_to_pass",
          filePath: "src/example.test.ts",
          testCommand: "pnpm test src/example.test.ts",
          content: "test('example regression', () => {});",
          rationale: "Covers the issue behavior.",
        },
      ],
      notes: [],
    });
    const calls: unknown[] = [];
    const builder = createOpenRouterTestBuilder({
      apiKey: "test-key",
      modelId: "test/model",
      fetchImpl: async (_url, init) => {
        calls.push(JSON.parse(String(init?.body)));
        return new Response(
          JSON.stringify({
            model: "test/model",
            choices: [
              {
                message: {
                  content: calls.length === 1 ? "{\"proposedTests\":[" : validContent,
                },
              },
            ],
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      },
    });

    const run = await builder.build({
      issueArtifact: {
        issue: {
          title: "Bug",
          body: "Something broke.",
          state: "closed",
          url: "https://github.com/example/repo/issues/1",
        },
      },
      pullRequestArtifact: {
        pullRequest: {
          title: "Fix bug",
          body: "Adds coverage.",
          html_url: "https://github.com/example/repo/pull/2",
        },
      },
      repositoryMetadataArtifact: {
        repository: { owner: "example", name: "repo" },
        base: { ref: "main", sha: "a".repeat(40) },
        head: { ref: "fix", sha: "b".repeat(40) },
        mergeSha: "c".repeat(40),
        changedFiles: [{ filename: "src/example.ts", status: "modified" }],
      },
    });

    assert.equal(run.attempts, 2);
    assert.equal(run.candidate.proposedTests.length, 1);
    assert.equal(calls.length, 2);
  });

  it("rejects empty or malformed proposals", () => {
    assert.throws(
      () => parseProposedTestBuilderCandidate({ proposedTests: [], notes: [] }),
      /proposedTests/,
    );
    assert.throws(
      () =>
        parseProposedTestBuilderCandidate({
          proposedTests: [
            {
              name: "bad kind",
              kind: "unknown",
              testCommand: "pnpm test",
              rationale: "bad",
            },
          ],
          notes: [],
        }),
      /Unsupported proposed test kind/,
    );
    assert.throws(
      () =>
        parseProposedTestBuilderCandidate({
          proposedTests: [
            {
              name: "missing materialized test",
              kind: "pass_to_pass",
              testCommand: "pnpm test",
              rationale: "bad",
            },
          ],
          notes: [],
        }),
      /filePath/,
    );
    assert.throws(
      () =>
        parseProposedTestBuilderCandidate({
          proposedTests: [
            {
              name: "unsafe path",
              kind: "pass_to_pass",
              filePath: "../escape.test.ts",
              testCommand: "pnpm test",
              content: "test('x', () => {});",
              rationale: "bad",
            },
          ],
          notes: [],
        }),
      /unsafe filePath/,
    );
    assert.throws(
      () =>
        parseProposedTestBuilderCandidate({
          proposedTests: [
            {
              name: "not a shell command",
              kind: "pass_to_pass",
              filePath: "src/example.test.ts",
              testCommand: "it('works', () => {})",
              content: "test('x', () => {});",
              rationale: "bad",
            },
          ],
          notes: [],
        }),
      /disallowed testCommand/,
    );
  });
});
