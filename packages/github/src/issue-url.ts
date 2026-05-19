export interface GitHubRepositoryRef {
  owner: string;
  repo: string;
}

export interface GitHubIssueRef extends GitHubRepositoryRef {
  issueNumber: number;
  canonicalUrl: string;
}

export type GitHubIssueUrlParseError =
  | "empty"
  | "invalid-url"
  | "unsupported-host"
  | "unsupported-protocol"
  | "not-an-issue-url"
  | "invalid-owner"
  | "invalid-repo"
  | "invalid-issue-number";

export interface GitHubIssueUrlParseResult {
  ok: boolean;
  value?: GitHubIssueRef;
  error?: GitHubIssueUrlParseError;
}

const GITHUB_HOSTS = new Set(["github.com", "www.github.com"]);
const OWNER_REPO_PATTERN = /^[A-Za-z0-9_.-]+$/;

export function parseGitHubIssueUrl(input: string): GitHubIssueUrlParseResult {
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

  const [owner, repo, resource, issueNumber, ...rest] = url.pathname
    .split("/")
    .filter(Boolean);

  if (resource !== "issues" || rest.length > 0) {
    return { ok: false, error: "not-an-issue-url" };
  }

  if (!owner || !OWNER_REPO_PATTERN.test(owner)) {
    return { ok: false, error: "invalid-owner" };
  }

  if (!repo || !OWNER_REPO_PATTERN.test(repo)) {
    return { ok: false, error: "invalid-repo" };
  }

  const parsedIssueNumber = Number(issueNumber);

  if (
    !issueNumber ||
    !Number.isSafeInteger(parsedIssueNumber) ||
    parsedIssueNumber <= 0 ||
    String(parsedIssueNumber) !== issueNumber
  ) {
    return { ok: false, error: "invalid-issue-number" };
  }

  return {
    ok: true,
    value: {
      owner,
      repo,
      issueNumber: parsedIssueNumber,
      canonicalUrl: buildGitHubIssueUrl({ owner, repo, issueNumber: parsedIssueNumber })
    }
  };
}

export function isGitHubIssueUrl(input: string): boolean {
  return parseGitHubIssueUrl(input).ok;
}

export function buildGitHubIssueUrl(ref: GitHubRepositoryRef & { issueNumber: number }): string {
  return `https://github.com/${ref.owner}/${ref.repo}/issues/${ref.issueNumber}`;
}
