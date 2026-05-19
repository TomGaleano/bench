import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createGitHubClient } from "./client.js";
import {
  fetchGitHubPullRequestFiles,
  importGitHubPullRequestDetail
} from "./pr-import.js";
import type { GitHubPullRequestRef } from "./pr-url.js";

const pullRequest: GitHubPullRequestRef = {
  owner: "octo",
  repo: "hello",
  pullNumber: 42,
  canonicalUrl: "https://github.com/octo/hello/pull/42"
};

describe("GitHub pull request detail helpers", () => {
  it("fetches pull request details and changed files through injected fetch", async () => {
    const paths: string[] = [];
    const client = createGitHubClient({
      baseUrl: "https://api.github.test",
      fetch: async (input) => {
        const url = new URL(String(input));
        paths.push(`${url.pathname}${url.search}`);

        if (url.pathname.endsWith("/files")) {
          return Response.json([
            {
              filename: "src/app.ts",
              status: "modified",
              patch: "@@ -1 +1 @@",
              sha: "file-sha",
              blob_url: "https://github.com/octo/hello/blob/main/src/app.ts",
              raw_url: "https://github.com/octo/hello/raw/main/src/app.ts",
              changes: 3,
              additions: 2,
              deletions: 1
            }
          ]);
        }

        return Response.json({
          number: 42,
          html_url: pullRequest.canonicalUrl,
          title: "Fix issue",
          body: "Closes #1",
          state: "closed",
          user: { login: "mona" },
          created_at: "c",
          updated_at: "u",
          closed_at: "x",
          merged_at: "m",
          merge_commit_sha: "merge-sha",
          base: { ref: "main", sha: "base-sha", label: "octo:main" },
          head: { ref: "fix", sha: "head-sha", label: "mona:fix" }
        });
      }
    });

    const imported = await importGitHubPullRequestDetail(client, pullRequest, {
      perPage: 50
    });

    assert.equal(imported.pullRequest.merge_commit_sha, "merge-sha");
    assert.equal(imported.pullRequest.merged_at, "m");
    assert.deepEqual(imported.pullRequest.base, {
      ref: "main",
      sha: "base-sha",
      label: "octo:main"
    });
    assert.deepEqual(imported.pullRequest.head, {
      ref: "fix",
      sha: "head-sha",
      label: "mona:fix"
    });
    assert.deepEqual(imported.files[0], {
      filename: "src/app.ts",
      status: "modified",
      patch: "@@ -1 +1 @@",
      sha: "file-sha",
      blob_url: "https://github.com/octo/hello/blob/main/src/app.ts",
      raw_url: "https://github.com/octo/hello/raw/main/src/app.ts",
      changes: 3,
      additions: 2,
      deletions: 1
    });
    assert.deepEqual(paths.sort(), [
      "/repos/octo/hello/pulls/42",
      "/repos/octo/hello/pulls/42/files?per_page=50&page=1"
    ]);
  });

  it("paginates changed files until a short page", async () => {
    const pages: string[] = [];
    const client = createGitHubClient({
      baseUrl: "https://api.github.test",
      fetch: async (input) => {
        const url = new URL(String(input));
        pages.push(url.searchParams.get("page") ?? "");

        return Response.json(
          url.searchParams.get("page") === "1"
            ? new Array(2).fill({
                filename: "src/app.ts",
                status: "modified",
                sha: "file-sha",
                blob_url: "blob",
                raw_url: "raw",
                changes: 1,
                additions: 1,
                deletions: 0
              })
            : [
                {
                  filename: "src/other.ts",
                  status: "added",
                  sha: "other-sha",
                  blob_url: "blob",
                  raw_url: "raw",
                  changes: 1,
                  additions: 1,
                  deletions: 0
                }
              ]
        );
      }
    });

    const files = await fetchGitHubPullRequestFiles(client, pullRequest, {
      perPage: 2,
      maxPages: 3
    });

    assert.equal(files.length, 3);
    assert.deepEqual(pages, ["1", "2"]);
  });
});
