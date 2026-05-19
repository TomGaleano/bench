import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createDiscoveryPipeline } from "./discovery-pipeline.js";
import { createPullRequestCandidate } from "./pr-candidate.js";

describe("createDiscoveryPipeline", () => {
  it("runs stages in order and annotates warnings", async () => {
    const pipeline = createDiscoveryPipeline([
      {
        name: "links",
        async run(context) {
          return {
            candidates: [
              createPullRequestCandidate({
                repository: context.issue,
                pullNumber: 10,
                url: "https://github.com/o/r/pull/10",
                status: "open",
                source: "linked-from-issue"
              })
            ],
            warnings: ["partial issue body"]
          };
        }
      }
    ]);

    const result = await pipeline.run({
      issue: {
        owner: "o",
        repo: "r",
        issueNumber: 1,
        canonicalUrl: "https://github.com/o/r/issues/1"
      },
      now: new Date("2026-01-01T00:00:00.000Z"),
      dryRun: true,
      metadata: {}
    });

    assert.equal(result.candidates.length, 1);
    assert.deepEqual(result.warnings, ["links: partial issue body"]);
  });
});
