import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createGitHubClient, createGitHubRequestHeaders, GitHubClientError } from "./client.js";
import { createSafeGitHubLogContext, readGitHubToken, redactGitHubToken } from "./token.js";

describe("GitHub token helpers", () => {
  it("reads and trims GITHUB_TOKEN without exposing its value in log context", () => {
    const env = { GITHUB_TOKEN: "  ghp_secret  " };

    assert.equal(readGitHubToken(env), "ghp_secret");
    assert.deepEqual(createSafeGitHubLogContext(env), {
      hasGitHubToken: true,
      tokenSource: "GITHUB_TOKEN"
    });
  });

  it("redacts known token values from strings", () => {
    const token = readGitHubToken({ GITHUB_TOKEN: "ghp_secret" });

    assert.equal(redactGitHubToken(`Bearer ${token}`, token), "Bearer [REDACTED_GITHUB_TOKEN]");
  });
});

describe("createGitHubClient", () => {
  it("uses injected fetch so tests do not make network calls", async () => {
    const requests: Request[] = [];
    const token = readGitHubToken({ GITHUB_TOKEN: "ghp_secret" });

    if (!token) {
      throw new Error("Expected token fixture to parse.");
    }

    const client = createGitHubClient({
      baseUrl: "https://api.github.test",
      token,
      fetch: async (input, init) => {
        requests.push(new Request(input, init));
        return Response.json({ ok: true });
      }
    });

    const result = await client.requestJson<{ ok: boolean }>("/repos/o/r/issues/1");

    assert.deepEqual(result, { ok: true });
    assert.equal(requests[0]?.url, "https://api.github.test/repos/o/r/issues/1");
    assert.equal(requests[0]?.headers.get("authorization"), "Bearer ghp_secret");
  });

  it("throws typed errors without logging token values", async () => {
    const client = createGitHubClient({
      baseUrl: "https://api.github.test",
      fetch: async () => new Response("nope", { status: 404 })
    });

    await assert.rejects(
      () => client.requestJson("/missing"),
      (error) =>
        error instanceof GitHubClientError &&
        error.status === 404 &&
        error.message === "GitHub request failed with status 404"
    );
  });
});

describe("createGitHubRequestHeaders", () => {
  it("sets GitHub API headers", () => {
    const headers = createGitHubRequestHeaders();

    assert.equal(headers.Accept, "application/vnd.github+json");
    assert.equal(headers["X-GitHub-Api-Version"], "2022-11-28");
  });
});
