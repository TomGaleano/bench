import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { GitHubIssueRef } from "./github-ref.js";
import {
  buildPullRequestCandidateSearchQuery,
  derivePullRequestCandidateConfidence,
  discoverPullRequestCandidates,
  extractLinkedPullRequestsFromTimeline
} from "./pr-discovery.js";
import type { ImportedGitHubPullRequest, ImportedGitHubTimelineEvent } from "./pr-discovery.js";

const issue: GitHubIssueRef = {
  owner: "octo",
  repo: "hello",
  issueNumber: 42,
  canonicalUrl: "https://github.com/octo/hello/issues/42"
};

describe("PR candidate search primitives", () => {
  it("builds closing-reference search queries", () => {
    assert.equal(
      buildPullRequestCandidateSearchQuery(issue),
      [
        '"fixes #42"',
        '"closes #42"',
        '"resolves #42"',
        '"fixes octo/hello#42"',
        '"closes octo/hello#42"',
        '"resolves octo/hello#42"',
        '"https://github.com/octo/hello/issues/42"'
      ].join(" OR ")
    );
  });

  it("scores closing references higher than plain mentions", () => {
    const closing = derivePullRequestCandidateConfidence({
      issue,
      pullRequest: pullRequest({ body: "Fixes #42", merged_at: "2026-01-02T00:00:00Z" })
    });
    const mention = derivePullRequestCandidateConfidence({
      issue,
      pullRequest: pullRequest({ body: "See #42 for context" })
    });

    assert.equal(closing.source, "closing-reference");
    assert.deepEqual(closing.reasons, [
      "body has a closing reference to issue #42",
      "body mentions issue #42",
      "PR is merged"
    ]);
    assert.equal(closing.confidence, 1);
    assert.equal(mention.source, "search-result");
    assert.equal(mention.confidence, 0.25);
  });

  it("derives cross-reference candidates from issue timeline", () => {
    const timeline: ImportedGitHubTimelineEvent[] = [
      {
        event: "cross-referenced",
        source: {
          issue: {
            number: 77,
            html_url: "https://github.com/octo/hello/pull/77",
            title: "Patch",
            body: "References #42",
            pull_request: {},
            state: "closed",
            user: { login: "mona" },
            labels: [{ name: "bug" }]
          }
        }
      }
    ];

    assert.deepEqual(extractLinkedPullRequestsFromTimeline(issue, timeline), [
      {
        number: 77,
        html_url: "https://github.com/octo/hello/pull/77",
        title: "Patch",
        body: "References #42",
        state: "closed",
        user: { login: "mona" },
        labels: [{ name: "bug" }],
        merged_at: null
      }
    ]);
  });

  it("discovers, deduplicates, and sorts candidates by confidence", () => {
    const timeline: ImportedGitHubTimelineEvent[] = [
      {
        event: "cross-referenced",
        source: {
          issue: {
            number: 5,
            html_url: "https://github.com/octo/hello/pull/5",
            title: "Maybe related",
            body: "See #42",
            pull_request: {},
            state: "open",
            user: null
          }
        }
      }
    ];

    const candidates = discoverPullRequestCandidates({
      issue,
      timeline,
      discoveredAt: "2026-01-01T00:00:00Z",
      pullRequests: [
        pullRequest({ number: 9, title: "Fixes octo/hello#42", body: null }),
        pullRequest({ number: 5, title: "Maybe related", body: "See #42" })
      ]
    });

    assert.equal(candidates.length, 2);
    assert.equal(candidates[0]?.pullNumber, 9);
    assert.equal(candidates[0]?.source, "closing-reference");
    assert.equal(candidates[1]?.pullNumber, 5);
    assert.equal(candidates[1]?.source, "cross-reference");
    assert.equal(candidates[1]?.confidence, 0.7);
  });
});

function pullRequest(overrides: Partial<ImportedGitHubPullRequest>): ImportedGitHubPullRequest {
  return {
    number: 1,
    html_url: "https://github.com/octo/hello/pull/1",
    title: "Patch",
    body: null,
    state: "closed",
    user: { login: "mona" },
    labels: [],
    ...overrides
  };
}
