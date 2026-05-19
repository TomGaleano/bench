import type { GitHubIssueRef, GitHubRepositoryRef } from "./github-ref.js";

export type PullRequestCandidateSource =
  | "linked-from-issue"
  | "closing-reference"
  | "cross-reference"
  | "search-result"
  | "manual"
  | "unknown";

export type PullRequestCandidateStatus =
  | "open"
  | "closed"
  | "merged"
  | "unknown";

export interface PullRequestCandidate {
  repository: GitHubRepositoryRef;
  pullNumber: number;
  url: string;
  title?: string;
  authorLogin?: string;
  status: PullRequestCandidateStatus;
  source: PullRequestCandidateSource;
  confidence: number;
  confidenceReasons: string[];
  relatedIssue?: GitHubIssueRef;
  discoveredAt: string;
  labels: string[];
}

export function createPullRequestCandidate(
  input: Omit<PullRequestCandidate, "confidence" | "confidenceReasons" | "discoveredAt" | "labels"> &
    Partial<Pick<PullRequestCandidate, "confidence" | "confidenceReasons" | "discoveredAt" | "labels">>
): PullRequestCandidate {
  return {
    ...input,
    confidence: input.confidence ?? 0,
    confidenceReasons: input.confidenceReasons ?? [],
    discoveredAt: input.discoveredAt ?? new Date().toISOString(),
    labels: input.labels ?? []
  };
}
