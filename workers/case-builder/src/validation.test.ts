import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CaseBuilderValidationPipeline } from "./validation.js";
import { createTestBuilderCandidate } from "./test-builder-candidate.js";

describe("CaseBuilderValidationPipeline", () => {
  it("prefixes validator issue codes and computes ok", async () => {
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
        confidence: 1
      },
      files: [],
      assertions: [],
      setupCommands: [],
      testCommands: [],
      notes: []
    });
    const pipeline = new CaseBuilderValidationPipeline([
      {
        name: "commands",
        async validate() {
          return [
            {
              code: "missing",
              message: "At least one test command is required.",
              severity: "error"
            }
          ];
        }
      }
    ]);

    assert.deepEqual(await pipeline.validate(candidate), {
      ok: false,
      issues: [
        {
          code: "commands.missing",
          message: "At least one test command is required.",
          severity: "error"
        }
      ]
    });
  });
});
