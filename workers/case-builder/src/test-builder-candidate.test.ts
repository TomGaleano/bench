import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createTestBuilderCandidate, isTestBuilderCandidate } from "./test-builder-candidate.js";

describe("test-builder candidate schema", () => {
  it("creates versioned candidates", () => {
    const candidate = createTestBuilderCandidate({
      metadata: {
        issue: {
          owner: "o",
          repo: "r",
          issueNumber: 1,
          canonicalUrl: "https://github.com/o/r/issues/1"
        },
        repository: { owner: "o", repo: "r" },
        discoveredAt: "2026-01-01T00:00:00.000Z",
        confidence: 0.5
      },
      files: [],
      assertions: [],
      setupCommands: [],
      testCommands: ["pnpm test"],
      notes: []
    });

    assert.equal(candidate.schemaVersion, "case-builder.test-candidate.v1");
    assert.equal(isTestBuilderCandidate(candidate), true);
    assert.equal(isTestBuilderCandidate({ schemaVersion: "wrong" }), false);
  });
});
