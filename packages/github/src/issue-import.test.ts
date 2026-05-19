import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createGitHubClient, GitHubClientError } from "./client.js";
import {
  fetchGitHubIssueComments,
  fetchGitHubIssueTimeline,
  importGitHubIssue,
  listGitHubPullRequests,
  searchGitHubPullRequests
} from "./issue-import.js";
import type { GitHubIssueRef } from "./issue-url.js";

const issue: GitHubIssueRef = {
  owner: "octo",
  repo: "hello",
  issueNumber: 42,
  canonicalUrl: "https://github.com/octo/hello/issues/42"
};

describe("GitHub issue import helpers", () => {
  it("fetches issue import resources through injected fetch", async () => {
    const paths: string[] = [];
    const client = createGitHubClient({
      baseUrl: "https://api.github.test",
      fetch: async (input) => {
        const url = new URL(String(input));
        paths.push(`${url.pathname}${url.search}`);

        if (url.pathname.endsWith("/comments")) {
          return Response.json([{ id: 1, html_url: "comment", body: "seen", user: null, created_at: "c", updated_at: "u" }]);
        }

        if (url.pathname.endsWith("/events")) {
          return Response.json([{ id: 2, event: "closed", created_at: "c" }]);
        }

        if (url.pathname.endsWith("/timeline")) {
          return Response.json([{ id: 3, event: "cross-referenced" }]);
        }

        return Response.json({
          number: 42,
          html_url: issue.canonicalUrl,
          title: "Bug",
          body: "broken",
          state: "closed",
          user: { login: "mona" },
          labels: [],
          created_at: "c",
          updated_at: "u",
          closed_at: "x"
        });
      }
    });

    const imported = await importGitHubIssue(client, issue, { perPage: 50 });

    assert.equal(imported.issue.title, "Bug");
    assert.equal(imported.comments.length, 1);
    assert.equal(imported.events[0]?.event, "closed");
    assert.equal(imported.timeline[0]?.event, "cross-referenced");
    assert.deepEqual(paths.sort(), [
      "/repos/octo/hello/issues/42",
      "/repos/octo/hello/issues/42/comments?per_page=50&page=1",
      "/repos/octo/hello/issues/42/events?per_page=50&page=1",
      "/repos/octo/hello/issues/42/timeline?per_page=50&page=1"
    ]);
  });

  it("paginates until a short page", async () => {
    const pages: string[] = [];
    const client = createGitHubClient({
      baseUrl: "https://api.github.test",
      fetch: async (input) => {
        const url = new URL(String(input));
        pages.push(url.searchParams.get("page") ?? "");
        return Response.json(url.searchParams.get("page") === "1" ? new Array(2).fill({ id: 1 }) : [{ id: 2 }]);
      }
    });

    const comments = await fetchGitHubIssueComments(client, issue, { perPage: 2, maxPages: 3 });

    assert.equal(comments.length, 3);
    assert.deepEqual(pages, ["1", "2"]);
  });

  it("treats unavailable timeline endpoint as empty", async () => {
    const client = createGitHubClient({
      baseUrl: "https://api.github.test",
      fetch: async () => new Response("missing", { status: 404 })
    });

    assert.deepEqual(await fetchGitHubIssueTimeline(client, issue), []);
  });

  it("does not hide non-404 timeline failures", async () => {
    const client = createGitHubClient({
      baseUrl: "https://api.github.test",
      fetch: async () => new Response("forbidden", { status: 403 })
    });

    await assert.rejects(() => fetchGitHubIssueTimeline(client, issue), GitHubClientError);
  });
});

describe("GitHub pull request helpers", () => {
  it("searches pull requests with repo and is:pull-request qualifiers", async () => {
    let path = "";
    const client = createGitHubClient({
      baseUrl: "https://api.github.test",
      fetch: async (input) => {
        const url = new URL(String(input));
        path = `${url.pathname}?${url.searchParams.toString()}`;
        return Response.json({ total_count: 1, incomplete_results: false, items: [] });
      }
    });

    await searchGitHubPullRequests(client, {
      repository: issue,
      query: '"fixes #42"',
      perPage: 25,
      sort: "updated",
      order: "desc"
    });

    assert.equal(
      path,
      "/search/issues?q=repo%3Aocto%2Fhello+is%3Apull-request+%22fixes+%2342%22&sort=updated&order=desc&per_page=25"
    );
  });

  it("lists pull requests with requested state", async () => {
    let path = "";
    const client = createGitHubClient({
      baseUrl: "https://api.github.test",
      fetch: async (input) => {
        const url = new URL(String(input));
        path = `${url.pathname}?${url.searchParams.toString()}`;
        return Response.json([]);
      }
    });

    await listGitHubPullRequests(client, { repository: issue, state: "closed", perPage: 10 });

    assert.equal(
      path,
      "/repos/octo/hello/pulls?state=closed&sort=updated&direction=desc&per_page=10&page=1"
    );
  });
});
