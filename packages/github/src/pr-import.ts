import type { GitHubClient } from "./client.js";
import type { GitHubListOptions, GitHubUserSummary } from "./issue-import.js";
import type { GitHubPullRequestRef } from "./pr-url.js";

export interface GitHubPullRequestBranchRef {
  ref: string;
  sha: string;
  label?: string;
}

export interface GitHubPullRequestDetail {
  number: number;
  html_url: string;
  title: string;
  body: string | null;
  state: "open" | "closed";
  user: GitHubUserSummary | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  merged_at: string | null;
  merge_commit_sha: string | null;
  base: GitHubPullRequestBranchRef;
  head: GitHubPullRequestBranchRef;
}

export interface GitHubPullRequestFile {
  filename: string;
  status: string;
  patch?: string;
  sha: string;
  blob_url: string;
  raw_url: string;
  changes: number;
  additions: number;
  deletions: number;
}

export interface GitHubPullRequestDetailImport {
  pullRequest: GitHubPullRequestDetail;
  files: GitHubPullRequestFile[];
}

/**
 * Fetches the raw diff (patch) for a pull request.
 * Returns the unified diff as a string.
 */
export async function fetchGitHubPullRequestDiff(
  client: GitHubClient,
  pullRequest: GitHubPullRequestRef,
): Promise<string> {
  return client.requestText(
    `${pullRequestPath(pullRequest)}`,
    { headers: { Accept: "application/vnd.github.v3.diff" } },
  );
}

export async function fetchGitHubPullRequest(
  client: GitHubClient,
  pullRequest: GitHubPullRequestRef
): Promise<GitHubPullRequestDetail> {
  return client.requestJson<GitHubPullRequestDetail>(pullRequestPath(pullRequest));
}

export async function fetchGitHubPullRequestFiles(
  client: GitHubClient,
  pullRequest: GitHubPullRequestRef,
  options: GitHubListOptions = {}
): Promise<GitHubPullRequestFile[]> {
  return fetchPaged<GitHubPullRequestFile>(
    client,
    `${pullRequestPath(pullRequest)}/files`,
    options
  );
}

export async function importGitHubPullRequestDetail(
  client: GitHubClient,
  pullRequest: GitHubPullRequestRef,
  options: GitHubListOptions = {}
): Promise<GitHubPullRequestDetailImport> {
  const [pullRequestDetails, files] = await Promise.all([
    fetchGitHubPullRequest(client, pullRequest),
    fetchGitHubPullRequestFiles(client, pullRequest, options)
  ]);

  return { pullRequest: pullRequestDetails, files };
}

async function fetchPaged<T>(
  client: GitHubClient,
  path: string,
  options: GitHubListOptions
): Promise<T[]> {
  const perPage = clampPageSize(options.perPage);
  const maxPages = Math.max(1, options.maxPages ?? 10);
  const items: T[] = [];

  for (let page = 1; page <= maxPages; page += 1) {
    const params = new URLSearchParams({
      per_page: String(perPage),
      page: String(page)
    });

    const pageItems = await client.requestJson<T[]>(withQuery(path, params));
    items.push(...pageItems);

    if (pageItems.length < perPage) {
      break;
    }
  }

  return items;
}

function pullRequestPath(pullRequest: GitHubPullRequestRef): string {
  return `/repos/${encodePath(pullRequest.owner)}/${encodePath(
    pullRequest.repo
  )}/pulls/${pullRequest.pullNumber}`;
}

function withQuery(path: string, params: URLSearchParams): string {
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

function clampPageSize(value: number | undefined): number {
  if (value === undefined) {
    return 100;
  }

  return Math.max(1, Math.min(100, Math.trunc(value)));
}

function encodePath(value: string): string {
  return encodeURIComponent(value);
}
