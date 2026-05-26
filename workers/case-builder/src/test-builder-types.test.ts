import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseProposedTestBuilderCandidate } from "./test-builder-types.js";

describe("parseProposedTestBuilderCandidate", () => {
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
          rationale: "Covers the issue behavior.",
        },
      ],
      notes: [],
    });
    assert.equal(candidate.schemaVersion, "pilab.test-builder.proposal.v1");
    assert.equal(candidate.proposedTests.length, 1);
    assert.equal(candidate.proposedTests[0]!.kind, "fail_to_pass");
  });

  it("rejects empty proposedTests", () => {
    assert.throws(
      () => parseProposedTestBuilderCandidate({ proposedTests: [], notes: [] }),
      /proposedTests/,
    );
  });

  it("rejects unknown kind", () => {
    assert.throws(
      () =>
        parseProposedTestBuilderCandidate({
          proposedTests: [
            {
              name: "bad kind",
              kind: "unknown",
              filePath: "x.test.ts",
              testCommand: "pnpm test",
              content: "test('x', () => {})",
              rationale: "bad",
            },
          ],
          notes: [],
        }),
      /Unsupported proposed test kind/,
    );
  });

  it("rejects missing filePath", () => {
    assert.throws(
      () =>
        parseProposedTestBuilderCandidate({
          proposedTests: [
            {
              name: "missing materialized test",
              kind: "pass_to_pass",
              testCommand: "pnpm test",
              content: "test('x', () => {})",
              rationale: "bad",
            },
          ],
          notes: [],
        }),
      /filePath/,
    );
  });

  it("rejects unsafe filePath", () => {
    assert.throws(
      () =>
        parseProposedTestBuilderCandidate({
          proposedTests: [
            {
              name: "unsafe path",
              kind: "pass_to_pass",
              filePath: "../escape.test.ts",
              testCommand: "pnpm test",
              content: "test('x', () => {})",
              rationale: "bad",
            },
          ],
          notes: [],
        }),
      /unsafe filePath/,
    );
  });

  it("rejects disallowed testCommand", () => {
    assert.throws(
      () =>
        parseProposedTestBuilderCandidate({
          proposedTests: [
            {
              name: "not a shell command",
              kind: "pass_to_pass",
              filePath: "src/example.test.ts",
              testCommand: "it('works', () => {})",
              content: "test('x', () => {})",
              rationale: "bad",
            },
          ],
          notes: [],
        }),
      /disallowed testCommand/,
    );
  });
});
