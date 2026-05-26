import type { CaseVersionDetail, GitHubCase, WorkersStatus } from "../../lib/api";

export type ImportedIssue = {
  id: string | number;
  repoOwner: string;
  repoName: string;
  issueNumber: string | number;
  url: string;
  title: string;
  state: string;
  labels: string[];
  commentCount: number;
  timelineEventCount: number;
};

export type PrCandidate = {
  repository: { owner: string; repo: string };
  pullNumber: string | number;
  url: string;
  title: string;
  authorLogin?: string;
  status: string;
  source: string;
  confidence: number;
  confidenceReasons: string[];
  relatedIssue?: string | number | null;
  discoveredAt: string;
  labels: string[];
};

export type ImportIssueResponse = {
  case: GitHubCase;
  issue: ImportedIssue;
  prCandidates: PrCandidate[];
  needsPrSelection: boolean;
  warnings: string[];
};

export type SelectedPullRequest = {
  id: string | number;
  repoOwner: string;
  repoName: string;
  prNumber: string | number;
  url: string;
  title: string;
  state: string;
  baseRef: string;
  baseSha: string;
  headRef: string;
  headSha: string;
  mergeSha: string | null;
  changedFileCount: number;
  mergedAt: string | null;
};

export type ChangedFile = {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
};

export type SweBenchStyleEntry = {
  schemaVersion: "pilab.swe-bench-style-entry.v1";
  instanceId: string;
  repo: string;
  issueNumber: number;
  pullNumber: number;
  baseCommit: string;
  goldCommit: string;
  problemStatement: string;
  issueUrl: string;
  prUrl: string;
  patchSource: "github_pull_request";
  testSource: "llm_proposed_pending_validation";
  failToPass: string[];
  passToPass: string[];
};

export type CaseVersionSummary = {
  id: string | number;
  version: string | number;
  status: string;
};

export type ArtifactSummary = {
  id: string | number;
  kind: string;
  objectKey: string;
  sha256: string;
  byteSize: number;
  contentType: string;
};

export type ValidationLogArtifactSummary = {
  id: string | number;
  kind: "validation_log";
  objectKey: string;
  byteSize: number;
  contentType: string;
};

export type JobProgress = {
  stage?: string;
  message?: string;
};

export type CaseBuilderJobSummary = {
  id: string | number;
  name: string;
  queueName: string;
  state: string;
  progress: number | JobProgress | null;
  attemptsMade: number;
  createdAt: string;
  processedAt: string | null;
  finishedAt: string | null;
  failedReason?: string | null;
  returnvalue?: unknown;
  data: unknown;
};

export type ProposedTestBuilderOutput = {
  caseId: string | number;
  caseVersionId: string | number;
  stage: "ready-for-validation";
  verifiedArtifactCount: number;
  proposedTestCount: number;
  failToPassCount: number;
  passToPassCount: number;
  candidateTestsArtifactId: string | number;
  validationAttemptId: string | number;
  validationJobId?: string | number;
  completedAt: string;
};

export type ValidationRunnerJobSummary = {
  id: string | number;
  name: string;
  queueName: string;
  state: string;
  progress: number | JobProgress | null;
  attemptsMade: number;
  createdAt: string;
  processedAt: string | null;
  finishedAt: string | null;
  failedReason?: string | null;
  returnvalue?: unknown;
  data: unknown;
};

export type ValidationRunnerOutput = {
  caseVersionId: string | number;
  validationAttemptId: string | number;
  status: "accepted" | "rejected" | "error";
  acceptedTestCount: number;
  rejectedTestCount: number;
  validationLogArtifact?: ValidationLogArtifactSummary;
  baseLogArtifact?: ValidationLogArtifactSummary;
  goldLogArtifact?: ValidationLogArtifactSummary;
  completedAt: string;
  rejectedTests?: Array<{
    testSpecId: string;
    name: string;
    kind: string;
    issues: Array<{ severity: string; code: string; message: string }>;
  }>;
};

export type SelectPrResponse = {
  case: GitHubCase;
  caseVersion?: CaseVersionSummary;
  artifacts?: ArtifactSummary[];
  caseBuilderJob?: CaseBuilderJobSummary;
  sweBenchStyleEntry?: SweBenchStyleEntry;
  pullRequest: SelectedPullRequest;
  changedFiles: ChangedFile[];
};

// ── Derived workflow state for the DAG ─────────────────────────────

export type NodeStatus = "pending" | "running" | "done" | "failed" | "skipped";

export type WorkflowNodeId =
  | "import"
  | "buildTests"
  | "validate"
  | "evaluatorLock"
  | "freeze";

export type WorkflowNode = {
  id: WorkflowNodeId;
  label: string;
  status: NodeStatus;
  currentStage?: { tag: string; message: string };
  attemptBadge?: { current: number; total: number };
  errorMessage?: string;
};

export type WorkflowEdge = { from: WorkflowNodeId; to: WorkflowNodeId };

export type WorkflowState = {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  activeNodeId: WorkflowNodeId;
};

// ── Raw state surfaced to detail panel ──────────────────────────────

export type CaseBuildSnapshot = {
  workflow: WorkflowState;
  importResult: ImportIssueResponse | null;
  selectedPrResult: SelectPrResponse | null;
  caseVersionDetail: CaseVersionDetail | null;
  caseBuilderJob: CaseBuilderJobSummary | null;
  validationRunnerJob: ValidationRunnerJobSummary | null;
  frozenCase: GitHubCase | null;
  rejectedCase: GitHubCase | null;
  workersStatus: WorkersStatus | null;
  errors: {
    import?: string;
    prSelection?: string;
    validation?: string;
    caseAction?: string;
  };
  isSubmittingImport: boolean;
  isSelectingPr: boolean;
  isFreezing: boolean;
  isRejecting: boolean;
};

export type CaseBuildActions = {
  importIssue(issueUrl: string): Promise<void>;
  selectPr(input: string): Promise<void>;
  freeze(): Promise<void>;
  reject(): Promise<void>;
  setActiveNode(id: WorkflowNodeId): void;
};
