import type { JsonValue } from "@pilab/object-store";

export type ProposedTestKind = "fail_to_pass" | "pass_to_pass";

export type ProposedTestSpec = {
  name: string;
  kind: ProposedTestKind;
  filePath: string;
  testCommand: string;
  expectedFailureMode?: string;
  expectedPassMode?: string;
  content: string;
  rationale: string;
};

export type BehavioralReproduction = {
  script: string;
  rationale: string;
};

export type ProposedTestBuilderCandidate = {
  schemaVersion: "pilab.test-builder.proposal.v1";
  proposedTests: ProposedTestSpec[];
  notes: string[];
  existingTestsFound?: boolean;
  behavioralReproduction?: BehavioralReproduction;
};

export type TestBuilderInput = {
  issueArtifact: JsonValue;
  pullRequestArtifact: JsonValue;
  repositoryMetadataArtifact: JsonValue;
  testPatchArtifact?: JsonValue;
  previousAttemptLogs?: JsonValue;
};

export type TestBuilderRun = {
  modelId: string;
  requestedAt: string;
  completedAt: string;
  candidate: ProposedTestBuilderCandidate;
  rawResponse: JsonValue;
  attempts: number;
};

// Test commands the validation runner is willing to execute.
const ALLOWED_COMMAND_PREFIXES = [
  "pnpm", "npm", "yarn", "npx", "node", "bun",
  "pytest", "python", "python3",
  "go test", "go ",
  "cargo test", "cargo ",
  "mvn", "gradle", "./gradlew",
];

export function parseProposedTestBuilderCandidate(
  value: unknown,
): ProposedTestBuilderCandidate {
  if (!isRecord(value)) {
    throw new Error("Test builder response must be an object");
  }

  const proposedTests = value.proposedTests;
  const notes = value.notes ?? [];

  if (!Array.isArray(proposedTests) || proposedTests.length === 0) {
    throw new Error("Test builder response must include non-empty proposedTests");
  }

  if (!Array.isArray(notes) || !notes.every((note) => typeof note === "string")) {
    throw new Error("Test builder response must include string notes");
  }

  const candidate: ProposedTestBuilderCandidate = {
    schemaVersion: "pilab.test-builder.proposal.v1",
    proposedTests: proposedTests.map(parseProposedTestSpec),
    notes,
  };

  const existingTestsFound = value.existingTestsFound;
  if (typeof existingTestsFound === "boolean") {
    candidate.existingTestsFound = existingTestsFound;
  }

  return candidate;
}

function parseProposedTestSpec(value: unknown): ProposedTestSpec {
  if (!isRecord(value)) {
    throw new Error("Proposed test must be an object");
  }

  const name = readString(value, "name");
  const kind = readString(value, "kind");
  const testCommand = readString(value, "testCommand");
  const rationale = readString(value, "rationale");

  if (kind !== "fail_to_pass" && kind !== "pass_to_pass") {
    throw new Error(`Unsupported proposed test kind: ${kind}`);
  }

  const filePath = normalizeRelativePath(readString(value, "filePath"));
  const content = readString(value, "content");

  if (filePath.startsWith("/") || filePath.includes("..") || filePath.includes("\0")) {
    throw new Error(`unsafe filePath: ${filePath}`);
  }
  if (!ALLOWED_COMMAND_PREFIXES.some((p) => testCommand.trim().startsWith(p))) {
    throw new Error(`disallowed testCommand: ${testCommand}`);
  }

  const spec: ProposedTestSpec = {
    name,
    kind,
    filePath,
    testCommand,
    content,
    rationale,
  };

  const expectedFailureMode = value.expectedFailureMode;
  if (typeof expectedFailureMode === "string") spec.expectedFailureMode = expectedFailureMode;
  const expectedPassMode = value.expectedPassMode;
  if (typeof expectedPassMode === "string") spec.expectedPassMode = expectedPassMode;

  return spec;
}

function normalizeRelativePath(value: string): string {
  let path = value.trim();
  if (path.startsWith("./")) path = path.slice(2);
  while (path.startsWith("/")) path = path.slice(1);
  return path;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: Record<string, unknown>, key: string): string {
  const inner = value[key];
  if (typeof inner !== "string" || inner.length === 0) {
    throw new Error(`Proposed test missing string field ${key}`);
  }
  return inner;
}
