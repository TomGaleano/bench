import type { GitHubIssueRef, GitHubRepositoryRef } from "./github-ref.js";
import type { PullRequestCandidate } from "./pr-candidate.js";

export interface TestBuilderCandidateFile {
  path: string;
  role: "source" | "test" | "fixture" | "config" | "unknown";
  language?: string;
  rationale?: string;
}

export interface TestBuilderCandidateAssertion {
  id: string;
  description: string;
  kind: "unit" | "integration" | "e2e" | "snapshot" | "static";
  targetFiles: string[];
}

export interface TestBuilderCandidateMetadata {
  issue: GitHubIssueRef;
  repository: GitHubRepositoryRef;
  pullRequest?: PullRequestCandidate;
  discoveredAt: string;
  confidence: number;
}

export interface TestBuilderCandidate {
  schemaVersion: "case-builder.test-candidate.v1";
  metadata: TestBuilderCandidateMetadata;
  files: TestBuilderCandidateFile[];
  assertions: TestBuilderCandidateAssertion[];
  setupCommands: string[];
  testCommands: string[];
  notes: string[];
}

export function createTestBuilderCandidate(
  input: Omit<TestBuilderCandidate, "schemaVersion">
): TestBuilderCandidate {
  return {
    schemaVersion: "case-builder.test-candidate.v1",
    ...input
  };
}

export function isTestBuilderCandidate(value: unknown): value is TestBuilderCandidate {
  if (!isRecord(value)) {
    return false;
  }

  return (
    value.schemaVersion === "case-builder.test-candidate.v1" &&
    isRecord(value.metadata) &&
    Array.isArray(value.files) &&
    Array.isArray(value.assertions) &&
    Array.isArray(value.setupCommands) &&
    Array.isArray(value.testCommands) &&
    Array.isArray(value.notes)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
