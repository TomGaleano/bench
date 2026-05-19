import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildGitHubIssueUrl, type GitHubIssueRef } from "./issue-url.js";
import { buildPullRequestCandidateSearchQuery } from "./pr-discovery.js";

describe("pull request discovery helpers", () => {
  it("builds a GitHub search query within the boolean operator limit", () => {
    const issue: GitHubIssueRef = {
      owner: "octo",
      repo: "hello",
      issueNumber: 42,
      canonicalUrl: buildGitHubIssueUrl({ owner: "octo", repo: "hello", issueNumber: 42 })
    };

    const query = buildPullRequestCandidateSearchQuery(issue);

    assert.match(query, /"fixes #42"/);
    assert.match(query, /"https:\/\/github.com\/octo\/hello\/issues\/42"/);
    assert.ok((query.match(/\bOR\b/g) ?? []).length <= 5);
  });
});
