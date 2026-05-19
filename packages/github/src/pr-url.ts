import type { GitHubRepositoryRef } from "./issue-url.js";

export interface GitHubPullRequestRef extends GitHubRepositoryRef {
  pullNumber: number;
  canonicalUrl: string;
}

export type GitHubPullRequestUrlParseError =
  | "empty"
  | "invalid-url"
  | "unsupported-host"
  | "unsupported-protocol"
  | "not-a-pull-request-url"
  | "invalid-owner"
  | "invalid-repo"
  | "invalid-pull-number";

export interface GitHubPullRequestUrlParseResult {
  ok: boolean;
  value?: GitHubPullRequestRef;
  error?: GitHubPullRequestUrlParseError;
}

const GITHUB_HOSTS = new Set(["github.com", "www.github.com"]);
const OWNER_REPO_PATTERN = /^[A-Za-z0-9_.-]+$/;

export function parseGitHubPullRequestUrl(
  input: string
): GitHubPullRequestUrlParseResult {
  const trimmed = input.trim();

  if (trimmed.length === 0) {
    return { ok: false, error: "empty" };
  }

  let url: URL;

  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, error: "invalid-url" };
  }

  if (url.protocol !== "https:") {
    return { ok: false, error: "unsupported-protocol" };
  }

  if (!GITHUB_HOSTS.has(url.hostname.toLowerCase())) {
    return { ok: false, error: "unsupported-host" };
  }

  const [owner, repo, resource, pullNumber, ...rest] = url.pathname
    .split("/")
    .filter(Boolean);

  if (resource !== "pull" || rest.length > 0) {
    return { ok: false, error: "not-a-pull-request-url" };
  }

  if (!owner || !OWNER_REPO_PATTERN.test(owner)) {
    return { ok: false, error: "invalid-owner" };
  }

  if (!repo || !OWNER_REPO_PATTERN.test(repo)) {
    return { ok: false, error: "invalid-repo" };
  }

  const parsedPullNumber = Number(pullNumber);

  if (
    !pullNumber ||
    !Number.isSafeInteger(parsedPullNumber) ||
    parsedPullNumber <= 0 ||
    String(parsedPullNumber) !== pullNumber
  ) {
    return { ok: false, error: "invalid-pull-number" };
  }

  return {
    ok: true,
    value: {
      owner,
      repo,
      pullNumber: parsedPullNumber,
      canonicalUrl: buildGitHubPullRequestUrl({
        owner,
        repo,
        pullNumber: parsedPullNumber
      })
    }
  };
}

export function isGitHubPullRequestUrl(input: string): boolean {
  return parseGitHubPullRequestUrl(input).ok;
}

export function buildGitHubPullRequestUrl(
  ref: GitHubRepositoryRef & { pullNumber: number }
): string {
  return `https://github.com/${ref.owner}/${ref.repo}/pull/${ref.pullNumber}`;
}
