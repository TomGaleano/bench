export interface GitHubRepositoryRef {
  owner: string;
  repo: string;
}

export interface GitHubIssueRef extends GitHubRepositoryRef {
  issueNumber: number;
  canonicalUrl: string;
}
