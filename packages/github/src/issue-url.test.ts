import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildGitHubIssueUrl, isGitHubIssueUrl, parseGitHubIssueUrl } from "./issue-url.js";

describe("parseGitHubIssueUrl", () => {
  it("parses and canonicalizes GitHub issue URLs", () => {
    const result = parseGitHubIssueUrl(
      " https://github.com/OpenAI/codex/issues/123?tab=timeline#event "
    );

    assert.equal(result.ok, true);
    assert.deepEqual(result.value, {
      owner: "OpenAI",
      repo: "codex",
      issueNumber: 123,
      canonicalUrl: "https://github.com/OpenAI/codex/issues/123"
    });
  });

  it("rejects pull request URLs", () => {
    assert.deepEqual(parseGitHubIssueUrl("https://github.com/o/r/pull/1"), {
      ok: false,
      error: "not-an-issue-url"
    });
  });

  it("rejects unsupported protocols and hosts", () => {
    assert.equal(parseGitHubIssueUrl("http://github.com/o/r/issues/1").error, "unsupported-protocol");
    assert.equal(parseGitHubIssueUrl("https://example.com/o/r/issues/1").error, "unsupported-host");
  });

  it("rejects invalid issue numbers", () => {
    assert.equal(parseGitHubIssueUrl("https://github.com/o/r/issues/0").error, "invalid-issue-number");
    assert.equal(parseGitHubIssueUrl("https://github.com/o/r/issues/1.2").error, "invalid-issue-number");
  });

  it("exposes small helpers", () => {
    assert.equal(isGitHubIssueUrl("https://github.com/o/r/issues/7"), true);
    assert.equal(buildGitHubIssueUrl({ owner: "o", repo: "r", issueNumber: 7 }), "https://github.com/o/r/issues/7");
  });
});
