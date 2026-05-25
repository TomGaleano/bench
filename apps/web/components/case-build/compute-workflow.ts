import type { CaseVersionDetail, GitHubCase } from "../../lib/api";
import type {
  CaseBuilderJobSummary,
  ImportIssueResponse,
  JobProgress,
  NodeStatus,
  SelectPrResponse,
  ValidationRunnerJobSummary,
  WorkflowEdge,
  WorkflowNode,
  WorkflowNodeId,
  WorkflowState,
} from "./types";

const MAX_TEST_GEN_ATTEMPTS = 3;

export type ComputeWorkflowInput = {
  importResult: ImportIssueResponse | null;
  selectedPrResult: SelectPrResponse | null;
  caseVersionDetail: CaseVersionDetail | null;
  caseBuilderJob: CaseBuilderJobSummary | null;
  validationRunnerJob: ValidationRunnerJobSummary | null;
  frozenCase: GitHubCase | null;
  rejectedCase: GitHubCase | null;
  isSubmittingImport: boolean;
  isSelectingPr: boolean;
  isFreezing: boolean;
  isRejecting: boolean;
  importError?: string;
  prSelectionError?: string;
  validationError?: string;
  caseActionError?: string;
};

export function computeWorkflow(input: ComputeWorkflowInput): WorkflowState {
  const imp = computeImport(input);
  const build = computeBuildTests(input, imp.status);
  const validate = computeValidate(input, build.status);
  const lock = computeEvaluatorLock(input, validate.status);
  const freeze = computeFreeze(input, validate.status, lock.status);

  const showLock = lock.status === "done";
  const nodes: WorkflowNode[] = showLock
    ? [imp, build, validate, lock, freeze]
    : [imp, build, validate, freeze];
  const edges: WorkflowEdge[] = showLock
    ? [
        { from: "import", to: "buildTests" },
        { from: "buildTests", to: "validate" },
        { from: "validate", to: "evaluatorLock" },
        { from: "evaluatorLock", to: "freeze" },
      ]
    : [
        { from: "import", to: "buildTests" },
        { from: "buildTests", to: "validate" },
        { from: "validate", to: "freeze" },
      ];

  return { nodes, edges, activeNodeId: pickActive(nodes) };
}

function pickActive(nodes: WorkflowNode[]): WorkflowNodeId {
  const running = nodes.find((n) => n.status === "running");
  if (running) return running.id;
  const failed = nodes.find((n) => n.status === "failed");
  if (failed) return failed.id;
  const pending = nodes.find((n) => n.status === "pending");
  if (pending) return pending.id;
  return nodes[nodes.length - 1]!.id;
}

// ── Per-node computers ──────────────────────────────────────────────

function computeImport(input: ComputeWorkflowInput): WorkflowNode {
  const node: WorkflowNode = { id: "import", label: "Import issue", status: "pending" };
  if (input.importError) {
    node.status = "failed";
    node.errorMessage = input.importError;
    return node;
  }
  if (input.isSubmittingImport) {
    node.status = "running";
    node.currentStage = { tag: "importing", message: "Fetching issue + discovering PR candidates" };
    return node;
  }
  if (input.selectedPrResult || input.importResult) {
    node.status = "done";
  }
  return node;
}

function computeBuildTests(input: ComputeWorkflowInput, importStatus: NodeStatus): WorkflowNode {
  const node: WorkflowNode = { id: "buildTests", label: "Build tests", status: "pending" };
  if (importStatus !== "done") return node;

  if (input.prSelectionError) {
    node.status = "failed";
    node.errorMessage = input.prSelectionError;
    return node;
  }
  if (input.isSelectingPr) {
    node.status = "running";
    node.currentStage = { tag: "selecting-pr", message: "Selecting pull request" };
    return node;
  }

  const job = input.caseBuilderJob;
  if (!job) return node;

  if (job.state === "failed") {
    node.status = "failed";
    node.errorMessage = job.failedReason ?? "Case-builder job failed";
    return node;
  }
  if (job.state === "completed") {
    node.status = "done";
    return node;
  }
  node.status = "running";
  const progress = jobProgress(job.progress);
  if (progress) node.currentStage = progress;
  return node;
}

function computeValidate(input: ComputeWorkflowInput, buildStatus: NodeStatus): WorkflowNode {
  const node: WorkflowNode = { id: "validate", label: "Validate tests", status: "pending" };
  if (buildStatus === "failed") {
    node.status = "skipped";
    return node;
  }
  if (buildStatus !== "done") return node;

  const detail = input.caseVersionDetail;
  const attempts = detail?.validationAttempts ?? [];
  const latest = [...attempts].sort((a, b) => b.attemptNumber - a.attemptNumber)[0];
  const job = input.validationRunnerJob;
  const currentAttempt = latest?.attemptNumber ?? 1;
  node.attemptBadge = { current: currentAttempt, total: MAX_TEST_GEN_ATTEMPTS };

  if (detail?.evaluatorStrategy === "deterministic_tests") {
    node.status = "done";
    return node;
  }
  if (detail?.evaluatorStrategy === "llm_evaluator_only") {
    node.status = "done";
    node.attemptBadge = { current: MAX_TEST_GEN_ATTEMPTS, total: MAX_TEST_GEN_ATTEMPTS };
    return node;
  }

  if (input.validationError) {
    node.status = "failed";
    node.errorMessage = input.validationError;
    return node;
  }
  if (job && job.state === "failed") {
    node.status = "failed";
    node.errorMessage = job.failedReason ?? `Attempt ${currentAttempt} failed`;
    return node;
  }
  if (job && (job.state === "active" || job.state === "waiting" || job.state === "delayed")) {
    node.status = "running";
    const progress = jobProgress(job.progress);
    if (progress) node.currentStage = progress;
    return node;
  }
  if (latest?.status === "rejected") {
    node.status = "running";
    node.currentStage = {
      tag: "retrying",
      message: `Attempt ${currentAttempt} rejected — enqueueing retry`,
    };
    return node;
  }
  if (latest?.status === "accepted") {
    node.status = "done";
    return node;
  }
  return node;
}

function computeEvaluatorLock(input: ComputeWorkflowInput, validateStatus: NodeStatus): WorkflowNode {
  const node: WorkflowNode = { id: "evaluatorLock", label: "LLM evaluator", status: "pending" };
  if (validateStatus === "skipped") {
    node.status = "skipped";
    return node;
  }
  const strategy = input.caseVersionDetail?.evaluatorStrategy;
  if (strategy === "llm_evaluator_only") {
    node.status = "done";
  }
  return node;
}

function computeFreeze(
  input: ComputeWorkflowInput,
  validateStatus: NodeStatus,
  _lockStatus: NodeStatus,
): WorkflowNode {
  const node: WorkflowNode = { id: "freeze", label: "Freeze", status: "pending" };
  if (validateStatus === "skipped") {
    node.status = "skipped";
    return node;
  }
  if (input.rejectedCase) {
    node.status = "failed";
    node.errorMessage = "Case was rejected";
    return node;
  }
  if (input.frozenCase) {
    node.status = "done";
    return node;
  }
  if (input.isFreezing) {
    node.status = "running";
    node.currentStage = { tag: "freezing", message: "Freezing case" };
    return node;
  }
  if (input.isRejecting) {
    node.status = "running";
    node.currentStage = { tag: "rejecting", message: "Rejecting case" };
    return node;
  }
  if (input.caseActionError) {
    node.status = "failed";
    node.errorMessage = input.caseActionError;
    return node;
  }
  return node;
}

function jobProgress(value: number | JobProgress | null | undefined): { tag: string; message: string } | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const stage = typeof value.stage === "string" ? value.stage : undefined;
  const message = typeof value.message === "string" ? value.message : undefined;
  if (!stage && !message) return undefined;
  return { tag: stage ?? "running", message: message ?? "" };
}
