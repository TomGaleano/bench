import type {
  GitHubIssue,
  GitHubLabelSummary,
  GitHubPullRequest,
  GitHubTimelineEvent
} from "./issue-import.js";
import type { GitHubIssueRef, GitHubRepositoryRef } from "./issue-url.js";
import {
  createPullRequestCandidate,
  type PullRequestCandidate,
  type PullRequestCandidateSource,
  type PullRequestCandidateStatus
} from "./pr-candidate.js";

export interface PullRequestConfidenceResult {
  confidence: number;
  reasons: string[];
  source: PullRequestCandidateSource;
}

export interface PullRequestCandidateDiscoveryInput {
  issue: GitHubIssueRef;
  pullRequests: GitHubPullRequest[];
  timeline?: GitHubTimelineEvent[];
  discoveredAt?: string;
}

export function buildPullRequestCandidateSearchQuery(issue: GitHubIssueRef): string {
  const repoIssue = `${issue.owner}/${issue.repo}#${issue.issueNumber}`;
  const localIssue = `#${issue.issueNumber}`;

  return [
    `"fixes ${localIssue}"`,
    `"closes ${localIssue}"`,
    `"resolves ${localIssue}"`,
    `"fixes ${repoIssue}"`,
    `"${issue.canonicalUrl}"`
  ].join(" OR ");
}

export function discoverPullRequestCandidates(
  input: PullRequestCandidateDiscoveryInput
): PullRequestCandidate[] {
  const byKey = new Map<string, PullRequestCandidate>();

  for (const pullRequest of [
    ...input.pullRequests,
    ...extractLinkedPullRequestsFromTimeline(input.issue, input.timeline ?? [])
  ]) {
    const candidateInput: Parameters<typeof createPullRequestCandidateFromGitHubPullRequest>[0] = {
      repository: input.issue,
      issue: input.issue,
      pullRequest
    };

    if (input.timeline) {
      candidateInput.timeline = input.timeline;
    }

    if (input.discoveredAt) {
      candidateInput.discoveredAt = input.discoveredAt;
    }

    const candidate = createPullRequestCandidateFromGitHubPullRequest(candidateInput);
    const key = `${candidate.repository.owner}/${candidate.repository.repo}#${candidate.pullNumber}`;
    const existing = byKey.get(key);

    if (!existing || candidate.confidence > existing.confidence) {
      byKey.set(key, candidate);
    }
  }

  return [...byKey.values()].sort((left, right) => right.confidence - left.confidence);
}

export function createPullRequestCandidateFromGitHubPullRequest(input: {
  repository: GitHubRepositoryRef;
  issue: GitHubIssueRef;
  pullRequest: GitHubPullRequest;
  timeline?: GitHubTimelineEvent[];
  discoveredAt?: string;
}): PullRequestCandidate {
  const confidenceInput: Parameters<typeof derivePullRequestCandidateConfidence>[0] = {
    issue: input.issue,
    pullRequest: input.pullRequest
  };

  if (input.timeline) {
    confidenceInput.timeline = input.timeline;
  }

  const confidence = derivePullRequestCandidateConfidence(confidenceInput);
  const candidateInput: Parameters<typeof createPullRequestCandidate>[0] = {
    repository: input.repository,
    pullNumber: input.pullRequest.number,
    url: input.pullRequest.html_url,
    title: input.pullRequest.title,
    status: toCandidateStatus(input.pullRequest),
    source: confidence.source,
    confidence: confidence.confidence,
    confidenceReasons: confidence.reasons,
    relatedIssue: input.issue,
    labels: labelNames(input.pullRequest.labels ?? [])
  };

  if (input.pullRequest.user?.login) {
    candidateInput.authorLogin = input.pullRequest.user.login;
  }

  if (input.discoveredAt) {
    candidateInput.discoveredAt = input.discoveredAt;
  }

  return createPullRequestCandidate(candidateInput);
}

export function derivePullRequestCandidateConfidence(input: {
  issue: GitHubIssueRef;
  pullRequest: GitHubPullRequest;
  timeline?: GitHubTimelineEvent[];
}): PullRequestConfidenceResult {
  const reasons: string[] = [];
  let confidence = 0;
  let source: PullRequestCandidateSource = "search-result";

  if (containsClosingReference(input.pullRequest.title, input.issue)) {
    confidence += 0.75;
    source = "closing-reference";
    reasons.push(`title has a closing reference to issue #${input.issue.issueNumber}`);
  }

  if (containsClosingReference(input.pullRequest.body, input.issue)) {
    confidence += 0.85;
    source = "closing-reference";
    reasons.push(`body has a closing reference to issue #${input.issue.issueNumber}`);
  }

  if (mentionsIssue(input.pullRequest.title, input.issue)) {
    confidence += 0.2;
    reasons.push(`title mentions issue #${input.issue.issueNumber}`);
  }

  if (mentionsIssue(input.pullRequest.body, input.issue)) {
    confidence += 0.25;
    reasons.push(`body mentions issue #${input.issue.issueNumber}`);
  }

  if (hasTimelineCrossReference(input.pullRequest, input.issue, input.timeline ?? [])) {
    confidence += 0.45;
    source = source === "closing-reference" ? source : "cross-reference";
    reasons.push(`issue timeline cross-references PR #${input.pullRequest.number}`);
  }

  if (input.pullRequest.merged_at) {
    confidence += 0.1;
    reasons.push("PR is merged");
  }

  if (reasons.length === 0) {
    confidence = 0.05;
    source = "search-result";
    reasons.push("PR was returned by candidate search");
  }

  return {
    confidence: roundConfidence(Math.min(confidence, 1)),
    reasons,
    source
  };
}

export function extractLinkedPullRequestsFromTimeline(
  issue: GitHubIssueRef,
  timeline: GitHubTimelineEvent[]
): GitHubPullRequest[] {
  return timeline
    .flatMap((event) => {
      const linkedIssue = event.source?.issue;

      if (event.event !== "cross-referenced" || !linkedIssue?.pull_request) {
        return [];
      }

      const pullRequest: GitHubPullRequest = {
        number: linkedIssue.number,
        html_url: linkedIssue.html_url,
        title: linkedIssue.title,
        body: linkedIssue.body,
        state: linkedIssue.state ?? "closed",
        user: linkedIssue.user ?? null,
        merged_at: null,
        created_at: linkedIssue.created_at,
        updated_at: linkedIssue.updated_at,
        closed_at: linkedIssue.closed_at
      };

      if (linkedIssue.labels) {
        pullRequest.labels = linkedIssue.labels;
      }

      return [pullRequest];
    })
    .filter((pullRequest) => pullRequest.html_url.includes(`/${issue.owner}/${issue.repo}/pull/`));
}

function containsClosingReference(text: string | null | undefined, issue: GitHubIssueRef): boolean {
  if (!text) {
    return false;
  }

  return closingReferencePatterns(issue).some((pattern) => pattern.test(text));
}

function mentionsIssue(text: string | null | undefined, issue: GitHubIssueRef): boolean {
  if (!text) {
    return false;
  }

  return issueMentionPatterns(issue).some((pattern) => pattern.test(text));
}

function hasTimelineCrossReference(
  pullRequest: GitHubPullRequest,
  issue: GitHubIssueRef,
  timeline: GitHubTimelineEvent[]
): boolean {
  return timeline.some((event) => {
    const linkedIssue = event.source?.issue;

    return (
      event.event === "cross-referenced" &&
      linkedIssue?.pull_request !== undefined &&
      linkedIssue.number === pullRequest.number &&
      linkedIssue.html_url.includes(`/${issue.owner}/${issue.repo}/pull/${pullRequest.number}`)
    );
  });
}

function closingReferencePatterns(issue: GitHubIssueRef): RegExp[] {
  const keyword = String.raw`(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)`;
  const local = String.raw`#${issue.issueNumber}\b`;
  const repo = `${escapeRegExp(issue.owner)}\\/${escapeRegExp(issue.repo)}#${issue.issueNumber}\\b`;
  const url = escapeRegExp(issue.canonicalUrl);

  return [
    new RegExp(String.raw`\b${keyword}\s+${local}`, "i"),
    new RegExp(String.raw`\b${keyword}\s+${repo}`, "i"),
    new RegExp(String.raw`\b${keyword}\s+${url}`, "i")
  ];
}

function issueMentionPatterns(issue: GitHubIssueRef): RegExp[] {
  return [
    new RegExp(String.raw`#${issue.issueNumber}\b`, "i"),
    new RegExp(`${escapeRegExp(issue.owner)}\\/${escapeRegExp(issue.repo)}#${issue.issueNumber}\\b`, "i"),
    new RegExp(escapeRegExp(issue.canonicalUrl), "i")
  ];
}

function toCandidateStatus(pullRequest: GitHubPullRequest): PullRequestCandidateStatus {
  if (pullRequest.merged_at) {
    return "merged";
  }

  return pullRequest.state;
}

function labelNames(labels: Array<GitHubLabelSummary | string>): string[] {
  return labels.map((label) => (typeof label === "string" ? label : label.name));
}

function roundConfidence(value: number): number {
  return Math.round(value * 100) / 100;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
