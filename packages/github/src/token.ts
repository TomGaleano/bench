export type GitHubToken = string & { readonly __brand: "GitHubToken" };

export function readGitHubToken(
  env: Record<string, string | undefined> = process.env
): GitHubToken | undefined {
  const token = env.GITHUB_TOKEN?.trim();

  if (!token) {
    return undefined;
  }

  return token as GitHubToken;
}

export function redactGitHubToken(value: string, token?: GitHubToken): string {
  if (!token) {
    return value;
  }

  return value.split(token).join("[REDACTED_GITHUB_TOKEN]");
}

export function createSafeGitHubLogContext(
  env: Record<string, string | undefined> = process.env
): { hasGitHubToken: boolean; tokenSource: "GITHUB_TOKEN" | "none" } {
  return readGitHubToken(env)
    ? { hasGitHubToken: true, tokenSource: "GITHUB_TOKEN" }
    : { hasGitHubToken: false, tokenSource: "none" };
}
