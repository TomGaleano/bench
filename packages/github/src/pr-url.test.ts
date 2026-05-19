import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildGitHubPullRequestUrl,
  isGitHubPullRequestUrl,
  parseGitHubPullRequestUrl
} from "./pr-url.js";

describe("parseGitHubPullRequestUrl", () => {
  it("parses and canonicalizes GitHub pull request URLs", () => {
    const result = parseGitHubPullRequestUrl(
      " https://github.com/OpenAI/codex/pull/123?tab=files#diff "
    );

    assert.equal(result.ok, true);
    assert.deepEqual(result.value, {
      owner: "OpenAI",
      repo: "codex",
      pullNumber: 123,
      canonicalUrl: "https://github.com/OpenAI/codex/pull/123"
    });
  });

  it("rejects issue URLs", () => {
    assert.deepEqual(parseGitHubPullRequestUrl("https://github.com/o/r/issues/1"), {
      ok: false,
      error: "not-a-pull-request-url"
    });
  });

  it("rejects unsupported protocols and hosts", () => {
    assert.equal(
      parseGitHubPullRequestUrl("http://github.com/o/r/pull/1").error,
      "unsupported-protocol"
    );
    assert.equal(
      parseGitHubPullRequestUrl("https://example.com/o/r/pull/1").error,
      "unsupported-host"
    );
  });

  it("rejects invalid pull numbers", () => {
    assert.equal(
      parseGitHubPullRequestUrl("https://github.com/o/r/pull/0").error,
      "invalid-pull-number"
    );
    assert.equal(
      parseGitHubPullRequestUrl("https://github.com/o/r/pull/1.2").error,
      "invalid-pull-number"
    );
  });

  it("exposes small helpers", () => {
    assert.equal(isGitHubPullRequestUrl("https://github.com/o/r/pull/7"), true);
    assert.equal(
      buildGitHubPullRequestUrl({ owner: "o", repo: "r", pullNumber: 7 }),
      "https://github.com/o/r/pull/7"
    );
  });
});
