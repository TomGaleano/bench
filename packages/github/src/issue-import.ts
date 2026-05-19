import { GitHubClientError, type GitHubClient } from "./client.js";
import type { GitHubIssueRef, GitHubRepositoryRef } from "./issue-url.js";

export interface GitHubUserSummary {
  login: string;
  html_url?: string;
}

export interface GitHubLabelSummary {
  name: string;
}

export interface GitHubIssue {
  number: number;
  html_url: string;
  title: string;
  body: string | null;
  state: "open" | "closed";
  user: GitHubUserSummary | null;
  labels: Array<GitHubLabelSummary | string>;
  pull_request?: unknown;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
}

export interface GitHubIssueComment {
  id: number;
  html_url: string;
  body: string | null;
  user: GitHubUserSummary | null;
  created_at: string;
  updated_at: string;
  author_association?: string;
}

export interface GitHubIssueEvent {
  id: number;
  event: string;
  commit_id?: string | null;
  commit_url?: string | null;
  created_at: string;
  actor?: GitHubUserSummary | null;
}

export interface GitHubTimelineEvent {
  id?: number;
  event: string;
  source?: {
    type?: string;
    issue?: GitHubIssue;
  };
  commit_id?: string | null;
  commit_url?: string | null;
  created_at?: string;
  actor?: GitHubUserSummary | null;
}

export interface GitHubPullRequest {
  number: number;
  html_url: string;
  title: string;
  body: string | null;
  state: "open" | "closed";
  merged_at?: string | null;
  user: GitHubUserSummary | null;
  labels?: Array<GitHubLabelSummary | string>;
  created_at: string;
  updated_at: string;
  closed_at?: string | null;
}

export interface GitHubPullRequestSearchResult {
  total_count: number;
  incomplete_results: boolean;
  items: GitHubPullRequest[];
}

export interface GitHubListOptions {
  perPage?: number;
  maxPages?: number;
}

export interface GitHubPullRequestSearchOptions extends GitHubListOptions {
  repository: GitHubRepositoryRef;
  query: string;
  sort?: "comments" | "created" | "interactions" | "reactions" | "reactions-+1" | "updated";
  order?: "asc" | "desc";
}

export interface GitHubPullRequestListOptions extends GitHubListOptions {
  repository: GitHubRepositoryRef;
  state?: "open" | "closed" | "all";
  sort?: "created" | "updated" | "popularity" | "long-running";
  direction?: "asc" | "desc";
}

export interface GitHubIssueImport {
  issue: GitHubIssue;
  comments: GitHubIssueComment[];
  events: GitHubIssueEvent[];
  timeline: GitHubTimelineEvent[];
}

export async function fetchGitHubIssue(
  client: GitHubClient,
  issue: GitHubIssueRef
): Promise<GitHubIssue> {
  return client.requestJson<GitHubIssue>(issuePath(issue));
}

export async function fetchGitHubIssueComments(
  client: GitHubClient,
  issue: GitHubIssueRef,
  options: GitHubListOptions = {}
): Promise<GitHubIssueComment[]> {
  return fetchPaged<GitHubIssueComment>(client, `${issuePath(issue)}/comments`, options);
}

export async function fetchGitHubIssueEvents(
  client: GitHubClient,
  issue: GitHubIssueRef,
  options: GitHubListOptions = {}
): Promise<GitHubIssueEvent[]> {
  return fetchPaged<GitHubIssueEvent>(client, `${issuePath(issue)}/events`, options);
}

export async function fetchGitHubIssueTimeline(
  client: GitHubClient,
  issue: GitHubIssueRef,
  options: GitHubListOptions = {}
): Promise<GitHubTimelineEvent[]> {
  try {
    return await fetchPaged<GitHubTimelineEvent>(client, `${issuePath(issue)}/timeline`, options);
  } catch (error) {
    if (error instanceof GitHubClientError && error.status === 404) {
      return [];
    }

    throw error;
  }
}

export async function importGitHubIssue(
  client: GitHubClient,
  issue: GitHubIssueRef,
  options: GitHubListOptions = {}
): Promise<GitHubIssueImport> {
  const [issueDetails, comments, events, timeline] = await Promise.all([
    fetchGitHubIssue(client, issue),
    fetchGitHubIssueComments(client, issue, options),
    fetchGitHubIssueEvents(client, issue, options),
    fetchGitHubIssueTimeline(client, issue, options)
  ]);

  return { issue: issueDetails, comments, events, timeline };
}

export async function listGitHubPullRequests(
  client: GitHubClient,
  options: GitHubPullRequestListOptions
): Promise<GitHubPullRequest[]> {
  const params = new URLSearchParams({
    state: options.state ?? "all",
    sort: options.sort ?? "updated",
    direction: options.direction ?? "desc"
  });

  return fetchPaged<GitHubPullRequest>(
    client,
    `/repos/${encodePath(options.repository.owner)}/${encodePath(options.repository.repo)}/pulls`,
    options,
    params
  );
}

export async function searchGitHubPullRequests(
  client: GitHubClient,
  options: GitHubPullRequestSearchOptions
): Promise<GitHubPullRequestSearchResult> {
  const params = new URLSearchParams({
    q: `repo:${options.repository.owner}/${options.repository.repo} is:pull-request ${options.query}`.trim()
  });

  if (options.sort) {
    params.set("sort", options.sort);
  }

  if (options.order) {
    params.set("order", options.order);
  }

  const result = await client.requestJson<GitHubPullRequestSearchResult>(
    withQuery("/search/issues", params, options)
  );

  return result;
}

async function fetchPaged<T>(
  client: GitHubClient,
  path: string,
  options: GitHubListOptions,
  initialParams = new URLSearchParams()
): Promise<T[]> {
  const perPage = clampPageSize(options.perPage);
  const maxPages = Math.max(1, options.maxPages ?? 10);
  const items: T[] = [];

  for (let page = 1; page <= maxPages; page += 1) {
    const params = new URLSearchParams(initialParams);
    params.set("per_page", String(perPage));
    params.set("page", String(page));

    const pageItems = await client.requestJson<T[]>(withQuery(path, params));
    items.push(...pageItems);

    if (pageItems.length < perPage) {
      break;
    }
  }

  return items;
}

function issuePath(issue: GitHubIssueRef): string {
  return `/repos/${encodePath(issue.owner)}/${encodePath(issue.repo)}/issues/${issue.issueNumber}`;
}

function withQuery(
  path: string,
  params: URLSearchParams,
  options?: Pick<GitHubListOptions, "perPage">
): string {
  if (options?.perPage !== undefined) {
    params.set("per_page", String(clampPageSize(options.perPage)));
  }

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
