"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { EmptyState, StatusPill } from "../../../components/ui";
import { Hero } from "../../../components/ui/Hero";
import type { CaseVersionDetail, GitHubCase, WorkersStatus } from "../../../lib/api";
import { freezeCase, getCaseVersionDetail, getWorkersStatus, rejectCase } from "../../../lib/api";

const steps = [
  { id: "source-issue", label: "Source", icon: "1" },
  { id: "validation", label: "Validation", icon: "2" },
  { id: "review-actions", label: "Review", icon: "3" },
] as const;

function parseGitHubIssueUrl(value: string) {
  try {
    const url = new URL(value);
    const segments = url.pathname.split("/").filter(Boolean);
    const [owner, repo, issueType, issueNumber] = segments;

    if (url.hostname !== "github.com" || !owner || !repo || issueType !== "issues" || !issueNumber) {
      return null;
    }

    return {
      issueNumber,
      issueUrl: url.toString(),
      repository: `${owner}/${repo}`,
      titleFallback: `${owner}/${repo}#${issueNumber}`
    };
  } catch {
    return null;
  }
}

type ImportedIssue = {
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

type PrCandidate = {
  repository: {
    owner: string;
    repo: string;
  };
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

type ImportIssueResponse = {
  case: GitHubCase;
  issue: ImportedIssue;
  prCandidates: PrCandidate[];
  needsPrSelection: boolean;
  warnings: string[];
};

type SelectedPullRequest = {
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

type ChangedFile = {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
};

type SweBenchStyleEntry = {
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

type CaseVersionSummary = {
  id: string | number;
  version: string | number;
  status: string;
};

type ArtifactSummary = {
  id: string | number;
  kind: string;
  objectKey: string;
  sha256: string;
  byteSize: number;
  contentType: string;
};

type ValidationLogArtifactSummary = {
  id: string | number;
  kind: "validation_log";
  objectKey: string;
  byteSize: number;
  contentType: string;
};

type CaseBuilderJobProgress = {
  stage?: string;
  message?: string;
};

type CaseBuilderJobSummary = {
  id: string | number;
  name: string;
  queueName: string;
  state: string;
  progress: number | CaseBuilderJobProgress | null;
  attemptsMade: number;
  createdAt: string;
  processedAt: string | null;
  finishedAt: string | null;
  failedReason?: string | null;
  returnvalue?: unknown;
  data: unknown;
};

type ProposedTestBuilderOutput = {
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

type ValidationRunnerJobProgress = {
  stage?: string;
  message?: string;
};

type ValidationRunnerJobSummary = {
  id: string | number;
  name: string;
  queueName: string;
  state: string;
  progress: number | ValidationRunnerJobProgress | null;
  attemptsMade: number;
  createdAt: string;
  processedAt: string | null;
  finishedAt: string | null;
  failedReason?: string | null;
  returnvalue?: unknown;
  data: unknown;
};

type ValidationRunnerOutput = {
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

type SelectPrResponse = {
  case: GitHubCase;
  caseVersion?: CaseVersionSummary;
  artifacts?: ArtifactSummary[];
  caseBuilderJob?: CaseBuilderJobSummary;
  sweBenchStyleEntry?: SweBenchStyleEntry;
  pullRequest: SelectedPullRequest;
  changedFiles: ChangedFile[];
};

async function importGitHubIssue(issueUrl: string) {
  const response = await fetch("/api/github/cases/import-issue", {
    body: JSON.stringify({ issueUrl }),
    headers: {
      "Content-Type": "application/json"
    },
    method: "POST"
  });

  if (!response.ok) {
    const message = await readApiErrorMessage(response);
    throw new Error(message || `Import failed with ${response.status}`);
  }

  return response.json() as Promise<ImportIssueResponse>;
}

async function selectPullRequest(caseId: string | number, input: string) {
  const trimmedInput = input.trim();
  const numericPr = /^\d+$/.test(trimmedInput) ? Number(trimmedInput) : null;
  const response = await fetch(`/api/github/cases/${encodeURIComponent(String(caseId))}/select-pr`, {
    body: JSON.stringify(numericPr === null ? { prUrl: trimmedInput } : { prNumber: numericPr }),
    headers: {
      "Content-Type": "application/json"
    },
    method: "POST"
  });

  if (!response.ok) {
    const message = await readApiErrorMessage(response);
    throw new Error(message || `PR selection failed with ${response.status}`);
  }

  return response.json() as Promise<SelectPrResponse>;
}

async function fetchCaseBuilderJob(jobId: string | number) {
  const response = await fetch(`/api/case-builder/jobs/${encodeURIComponent(String(jobId))}`);

  if (!response.ok) {
    const message = await readApiErrorMessage(response);
    throw new Error(message || `Case-builder job lookup failed with ${response.status}`);
  }

  return response.json() as Promise<CaseBuilderJobSummary>;
}

async function fetchValidationRunnerJob(jobId: string | number) {
  const response = await fetch(`/api/validation-runner/jobs/${encodeURIComponent(String(jobId))}`);

  if (!response.ok) {
    const message = await readApiErrorMessage(response);
    throw new Error(message || `Validation-runner job lookup failed with ${response.status}`);
  }

  return response.json() as Promise<ValidationRunnerJobSummary>;
}

function formatConfidence(value: number) {
  if (value > 1) {
    return `${Math.round(value)}%`;
  }

  return `${Math.round(value * 100)}%`;
}

async function readApiErrorMessage(response: Response) {
  const fallback = `Request failed with ${response.status}`;
  const contentType = response.headers.get("content-type") ?? "";
  const maxLength = 220;

  try {
    if (contentType.includes("application/json")) {
      const payload = await response.json() as unknown;
      const message = extractApiErrorMessage(payload);
      return truncateMessage(message ?? fallback, maxLength);
    }

    const text = await response.text();
    return truncateMessage(text || fallback, maxLength);
  } catch {
    return fallback;
  }
}

function extractApiErrorMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const record = payload as Record<string, unknown>;
  for (const key of ["message", "error", "detail"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }

  return null;
}

function truncateMessage(message: string, maxLength: number) {
  const normalized = message.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 3)}...`;
}

function formatByteSize(value: number) {
  return new Intl.NumberFormat("en", {
    maximumFractionDigits: 0
  }).format(value);
}

function getCaseBuilderProgress(progress: CaseBuilderJobSummary["progress"]) {
  if (!progress || typeof progress !== "object" || Array.isArray(progress)) {
    return null;
  }

  const stage = typeof progress.stage === "string" ? progress.stage : null;
  const message = typeof progress.message === "string" ? progress.message : null;

  if (!stage && !message) {
    return null;
  }

  return { stage, message };
}

function getValidationRunnerProgress(progress: ValidationRunnerJobSummary["progress"]) {
  if (!progress || typeof progress !== "object" || Array.isArray(progress)) {
    return null;
  }

  const stage = typeof progress.stage === "string" ? progress.stage : null;
  const message = typeof progress.message === "string" ? progress.message : null;

  if (!stage && !message) {
    return null;
  }

  return { stage, message };
}

function getProposedTestBuilderOutput(returnvalue: unknown): ProposedTestBuilderOutput | null {
  if (!returnvalue || typeof returnvalue !== "object" || Array.isArray(returnvalue)) {
    return null;
  }

  const value = returnvalue as Record<string, unknown>;
  const hasStringOrNumber = (key: keyof ProposedTestBuilderOutput) => {
    const field = value[key];
    return typeof field === "string" || typeof field === "number";
  };
  const hasNumber = (key: keyof ProposedTestBuilderOutput) => typeof value[key] === "number";

  if (
    !hasStringOrNumber("caseId") ||
    !hasStringOrNumber("caseVersionId") ||
    value.stage !== "ready-for-validation" ||
    !hasNumber("verifiedArtifactCount") ||
    !hasNumber("proposedTestCount") ||
    !hasNumber("failToPassCount") ||
    !hasNumber("passToPassCount") ||
    !hasStringOrNumber("candidateTestsArtifactId") ||
    !hasStringOrNumber("validationAttemptId") ||
    typeof value.completedAt !== "string"
  ) {
    return null;
  }

  return value as ProposedTestBuilderOutput;
}

function getValidationRunnerOutput(returnvalue: unknown): ValidationRunnerOutput | null {
  if (!returnvalue || typeof returnvalue !== "object" || Array.isArray(returnvalue)) {
    return null;
  }

  const value = returnvalue as Record<string, unknown>;
  const hasStringOrNumber = (key: keyof ValidationRunnerOutput) => {
    const field = value[key];
    return typeof field === "string" || typeof field === "number";
  };

  if (
    !hasStringOrNumber("caseVersionId") ||
    !hasStringOrNumber("validationAttemptId") ||
    (value.status !== "accepted" && value.status !== "rejected" && value.status !== "error") ||
    typeof value.acceptedTestCount !== "number" ||
    typeof value.rejectedTestCount !== "number" ||
    typeof value.completedAt !== "string"
  ) {
    return null;
  }

  const rejectedTests = Array.isArray(value.rejectedTests)
    ? value.rejectedTests.filter(
        (t: unknown): t is NonNullable<ValidationRunnerOutput["rejectedTests"]>[number] =>
          typeof t === "object" &&
          t !== null &&
          "testSpecId" in t &&
          "name" in t &&
          "kind" in t &&
          Array.isArray((t as Record<string, unknown>).issues),
      )
    : null;

  const output: ValidationRunnerOutput = { ...(value as ValidationRunnerOutput) };
  if (rejectedTests && rejectedTests.length > 0) {
    output.rejectedTests = rejectedTests;
  }

  return output;
}

function getValidationLogArtifacts(output: ValidationRunnerOutput | null) {
  if (!output) {
    return [];
  }

  return [
    ["Validation", output.validationLogArtifact],
    ["Base", output.baseLogArtifact],
    ["Gold", output.goldLogArtifact],
  ].filter((item): item is [string, ValidationLogArtifactSummary] => Boolean(item[1]));
}

function isTerminalJobState(state: string) {
  return state === "completed" || state === "failed" || state === "cancelled";
}

function formatElapsed(startIso: string | null, endIso: string | null): string {
  if (!startIso) return "";
  const start = new Date(startIso).getTime();
  const end = endIso ? new Date(endIso).getTime() : Date.now();
  const diffMs = Math.max(0, end - start);
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainSeconds = seconds % 60;
  return `${minutes}m ${remainSeconds}s`;
}

function getStageLabel(stage: string | null): string {
  if (!stage) return "Processing";
  const map: Record<string, string> = {
    "loading-case-version": "Loading case version",
    "validating-artifacts": "Validating linked data",
    "ready-for-test-builder": "Case version verified",
    "building-test-candidate": "Building proposed tests",
    "persisting-proposed-tests": "Persisting proposed tests",
    "ready-for-validation": "Queued for validation",
    "loading-validation-attempt": "Loading validation attempt",
    "docker-setup": "Setting up Docker evaluator",
    "validating-inputs": "Validating test inputs",
    "checking-repository-refs": "Cloning repository refs",
    "setting-up-environment": "Setting up environment",
    "validating-test-patch": "Running PR test patch",
    "running-behavioral-reproduction": "Running behavioral reproduction",
    "validating-tests": "Running proposed tests",
    "running-grader": "Running grader evaluation",
    "persisting-results": "Persisting results",
    "completed": "Completed",
    "failed": "Failed",
    "error": "Error",
    "cancelled": "Cancelled",
    accepted: "Validation accepted",
    rejected: "Validation rejected",
  };
  return map[stage] ?? stage.replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

function getStagePhase(stage: string | null): "build" | "validate" | "done" | "unknown" {
  if (!stage) return "unknown";
  if (["loading-case-version", "validating-artifacts", "ready-for-test-builder"].includes(stage)) return "build";
  if (["loading-validation-attempt", "docker-setup", "validating-inputs", "checking-repository-refs", "setting-up-environment", "validating-test-patch", "running-behavioral-reproduction", "validating-tests", "running-grader", "persisting-results"].includes(stage)) return "validate";
  if (["completed", "accepted", "rejected"].includes(stage)) return "done";
  if (stage === "failed" || stage === "error" || stage === "cancelled") return "done";
  return "unknown";
}

export default function NewCasePage() {
  const [importResult, setImportResult] = useState<ImportIssueResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedPrResult, setSelectedPrResult] = useState<SelectPrResponse | null>(null);
  const [prSelectionError, setPrSelectionError] = useState<string | null>(null);
  const [isSelectingPr, setIsSelectingPr] = useState(false);
  const [selectingPrUrl, setSelectingPrUrl] = useState<string | null>(null);
  const [validationRunnerJob, setValidationRunnerJob] = useState<ValidationRunnerJobSummary | null>(null);
  const [caseVersionDetail, setCaseVersionDetail] = useState<CaseVersionDetail | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [caseActionError, setCaseActionError] = useState<string | null>(null);
  const [isFreezing, setIsFreezing] = useState(false);
  const [isRejecting, setIsRejecting] = useState(false);
  const [frozenCase, setFrozenCase] = useState<GitHubCase | null>(null);
  const [rejectedCase, setRejectedCase] = useState<GitHubCase | null>(null);
  const [workersStatus, setWorkersStatus] = useState<WorkersStatus | null>(null);
  const [validationPollCount, setValidationPollCount] = useState(0);

  useEffect(() => {
    let cancelled = false;

    void getWorkersStatus()
      .then((status) => {
        if (!cancelled) {
          setWorkersStatus(status);
        }
      })
      .catch(() => {});

    const interval = window.setInterval(() => {
      void getWorkersStatus()
        .then((status) => {
          if (!cancelled) {
            setWorkersStatus(status);
          }
        })
        .catch(() => {});
    }, 10_000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  const workersMissing = workersStatus
    ? !workersStatus.caseBuilder.hasWorkers || !workersStatus.validationRunner.hasWorkers
    : false;

  const validationRunnerJobRef = useRef<ValidationRunnerJobSummary | null>(null);
  const proposedTestBuilderOutputRef = useRef<ProposedTestBuilderOutput | null>(null);

  useEffect(() => {
    validationRunnerJobRef.current = validationRunnerJob;
  }, [validationRunnerJob]);

  useEffect(() => {
    const job = selectedPrResult?.caseBuilderJob;

    if (!job || isTerminalJobState(job.state)) {
      return;
    }

    let cancelled = false;
    const interval = window.setInterval(() => {
      void fetchCaseBuilderJob(job.id)
        .then((latestJob) => {
          if (cancelled) {
            return;
          }

          setSelectedPrResult((current) =>
            current ? { ...current, caseBuilderJob: latestJob } : current,
          );
        })
        .catch((caught) => {
          if (!cancelled) {
            setPrSelectionError(
              caught instanceof Error ? caught.message : "Unable to refresh case-builder job",
            );
          }
        });
    }, 2_000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [selectedPrResult?.caseBuilderJob?.id, selectedPrResult?.caseBuilderJob?.state]);

  useEffect(() => {
    const proposedOutput = getProposedTestBuilderOutput(
      selectedPrResult?.caseBuilderJob?.returnvalue ?? null,
    );
    proposedTestBuilderOutputRef.current = proposedOutput;
    const validationJobId = proposedOutput?.validationJobId;

    if (!validationJobId) {
      setValidationRunnerJob(null);
      return;
    }

    let cancelled = false;

    const refresh = () => {
      void fetchValidationRunnerJob(validationJobId)
        .then((latestJob) => {
          if (!cancelled) {
            setValidationRunnerJob(latestJob);
            setValidationPollCount((c) => c + 1);
          }
        })
        .catch((caught) => {
          if (!cancelled) {
            if (caught instanceof Error && caught.message.includes("404")) {
              // Validation job not yet created; keep polling silently
              return;
            }
            setValidationError(
              caught instanceof Error ? caught.message : "Unable to refresh validation-runner job",
            );
          }
        });
    };

    refresh();
    const interval = window.setInterval(() => {
      const currentJob = validationRunnerJobRef.current;
      if (!currentJob || !isTerminalJobState(currentJob.state)) {
        refresh();
      }
    }, 2_000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [selectedPrResult?.caseBuilderJob?.returnvalue]);

  useEffect(() => {
    const caseId = selectedPrResult?.case.id;
    const versionId = selectedPrResult?.caseVersion?.id;

    if (!caseId || !versionId) {
      setCaseVersionDetail(null);
      return;
    }

    let cancelled = false;

    const refresh = () => {
      void getCaseVersionDetail(String(caseId), String(versionId))
        .then((detail) => {
          if (!cancelled) {
            setCaseVersionDetail(detail);
          }
        })
        .catch(() => {});
    };

    refresh();
    const interval = window.setInterval(refresh, 4_000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [selectedPrResult?.case.id, selectedPrResult?.caseVersion?.id, validationPollCount]);

  async function submitCase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setImportResult(null);
    setSelectedPrResult(null);
    setCaseVersionDetail(null);
    setValidationRunnerJob(null);
    setPrSelectionError(null);
    setValidationError(null);
    setValidationPollCount(0);
    setIsSubmitting(true);

    const formData = new FormData(event.currentTarget);
    const issueUrl = String(formData.get("issueUrl") ?? "").trim();
    const parsedIssue = parseGitHubIssueUrl(issueUrl);

    if (!parsedIssue) {
      setError("Enter a GitHub issue URL like https://github.com/owner/repo/issues/123");
      setIsSubmitting(false);
      return;
    }

    try {
      const result = await importGitHubIssue(parsedIssue.issueUrl);
      setImportResult(result);

      if (result.prCandidates.length === 1 && !result.needsPrSelection) {
        const candidate = result.prCandidates[0];
        if (candidate) {
          try {
            const prResult = await selectPullRequest(result.case.id, candidate.url);
            setSelectedPrResult(prResult);
            setImportResult((current) => current ? { ...current, case: prResult.case, needsPrSelection: false } : current);
          } catch (caught) {
            setPrSelectionError(caught instanceof Error ? caught.message : "Auto-select PR failed");
          }
        }
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to import issue");
    } finally {
      setIsSubmitting(false);
    }
  }

  const submitPrSelection = useCallback(async (input: string) => {
    const caseId = importResult?.case.id;

    if (caseId === undefined || caseId === null) {
      setPrSelectionError("Import an issue before selecting a PR.");
      return;
    }

    const trimmedInput = input.trim();

    if (!trimmedInput) {
      setPrSelectionError("Enter a pull request URL or number.");
      return;
    }

    setPrSelectionError(null);
    setIsSelectingPr(true);
    setSelectingPrUrl(trimmedInput.startsWith("http") ? trimmedInput : null);
    setCaseVersionDetail(null);
    setValidationError(null);
    setValidationPollCount(0);

    try {
      const result = await selectPullRequest(caseId, trimmedInput);
      setSelectedPrResult(result);
      setImportResult((current) => current ? { ...current, case: result.case, needsPrSelection: false } : current);
    } catch (caught) {
      setPrSelectionError(caught instanceof Error ? caught.message : "Unable to select PR");
    } finally {
      setIsSelectingPr(false);
      setSelectingPrUrl(null);
    }
  }, [importResult?.case.id]);

  async function handleManualPr(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    await submitPrSelection(String(formData.get("prInput") ?? ""));
  }

  async function handleFreezeCase() {
    const caseId = importResult?.case.id;
    if (!caseId) {
      setCaseActionError("No case to freeze.");
      return;
    }

    setCaseActionError(null);
    setIsFreezing(true);

    try {
      const result = await freezeCase(String(caseId));
      setFrozenCase(result);
      setImportResult((current) => current ? { ...current, case: result } : current);
    } catch (caught) {
      setCaseActionError(caught instanceof Error ? caught.message : "Unable to freeze case");
    } finally {
      setIsFreezing(false);
    }
  }

  async function handleRejectCase() {
    const caseId = importResult?.case.id;
    if (!caseId) {
      setCaseActionError("No case to reject.");
      return;
    }

    setCaseActionError(null);
    setIsRejecting(true);

    try {
      const result = await rejectCase(String(caseId));
      setRejectedCase(result);
      setImportResult((current) => current ? { ...current, case: result } : current);
    } catch (caught) {
      setCaseActionError(caught instanceof Error ? caught.message : "Unable to reject case");
    }
  }

  const createdCase = importResult?.case ?? null;
  const issue = importResult?.issue ?? null;
  const prCandidates = importResult?.prCandidates ?? [];
  const selectedPr = selectedPrResult?.pullRequest ?? null;
  const shouldShowPrSelection = Boolean(importResult && !selectedPr && (importResult.needsPrSelection || prCandidates.length));
  const sweBenchStyleEntry = selectedPrResult?.sweBenchStyleEntry ?? null;
  const caseVersion = selectedPrResult?.caseVersion ?? null;
  const artifacts = selectedPrResult?.artifacts ?? [];
  const caseBuilderJob = selectedPrResult?.caseBuilderJob ?? null;
  const caseBuilderProgress = getCaseBuilderProgress(caseBuilderJob?.progress ?? null);
  const proposedTestBuilderOutput = getProposedTestBuilderOutput(caseBuilderJob?.returnvalue ?? null);
  const validationRunnerProgress = getValidationRunnerProgress(validationRunnerJob?.progress ?? null);
  const validationRunnerOutput = getValidationRunnerOutput(validationRunnerJob?.returnvalue ?? null);
  const validationLogArtifacts = getValidationLogArtifacts(validationRunnerOutput);
  const validationAttempts = useMemo(
    () => [...(caseVersionDetail?.validationAttempts ?? [])].sort((a, b) => a.attemptNumber - b.attemptNumber),
    [caseVersionDetail?.validationAttempts],
  );
  const latestValidationAttempt = validationAttempts.at(-1) ?? null;
  const evaluatorStrategy = caseVersionDetail?.evaluatorStrategy ?? null;
  const latestValidationStatus = validationRunnerOutput?.status ?? latestValidationAttempt?.status ?? null;
  const validationComplete = Boolean(
    (validationRunnerOutput && isTerminalJobState(validationRunnerJob?.state ?? "")) ||
    (latestValidationAttempt &&
      ["accepted", "rejected", "error"].includes(latestValidationAttempt.status)) ||
    evaluatorStrategy !== null,
  );

  const activeStepIndex = useMemo(() => {
    if (frozenCase || rejectedCase || validationComplete) {
      return 2;
    }

    if (caseBuilderJob || validationRunnerJob || proposedTestBuilderOutput) {
      return 1;
    }

    return 0;
  }, [
    caseBuilderJob,
    validationRunnerJob,
    validationComplete,
    frozenCase,
    proposedTestBuilderOutput,
    rejectedCase,
  ]);

  const isBuilding = Boolean(caseBuilderJob) && !isTerminalJobState(caseBuilderJob?.state ?? "");
  const isValidating = Boolean(validationRunnerJob) && !isTerminalJobState(validationRunnerJob?.state ?? "");
  const caseBuilderFailed = Boolean(caseBuilderJob) && caseBuilderJob?.state === "failed";
  const validationRunnerFailed = Boolean(validationRunnerJob) && validationRunnerJob?.state === "failed";
  const validationSkipped = caseBuilderFailed && !validationRunnerJob && !proposedTestBuilderOutput;
  const currentStageLabel = isValidating
    ? getStageLabel(validationRunnerProgress?.stage ?? null)
    : isBuilding
      ? getStageLabel(caseBuilderProgress?.stage ?? null)
      : null;
  const currentStageMessage = isValidating
    ? validationRunnerProgress?.message ?? null
    : isBuilding
      ? caseBuilderProgress?.message ?? null
      : null;
  const currentPhase = isValidating
    ? getStagePhase(validationRunnerProgress?.stage ?? null)
    : isBuilding
      ? getStagePhase(caseBuilderProgress?.stage ?? null)
      : null;

  const buildStartedAt = caseBuilderJob?.createdAt ?? null;
  const validateStartedAt = validationRunnerJob?.createdAt ?? buildStartedAt;

  return (
    <div className="mdl-page wz-page">
      <Hero
        eyebrow={`New case · Step ${activeStepIndex + 1} of ${steps.length}`}
        live={isSubmitting || isSelectingPr || isFreezing || isRejecting || isBuilding || isValidating}
        title={
          <>
            Start from a <em>GitHub issue</em>.
          </>
        }
        lede="Import the source issue, review the fixing PR, then watch the entry, LLM test proposal, and validation state appear in sequence."
        meta={[
          ["Case", createdCase?.id?.slice(0, 8) ?? "Not created"],
          ["Step", `${activeStepIndex + 1}/${steps.length}`],
        ]}
      />

      <nav className="wz-rail" aria-label="Wizard steps">
        {steps.map((step, index) => {
          const state =
            index === activeStepIndex ? "active" : index < activeStepIndex ? "complete" : "todo";
          const isProcessing =
            index === activeStepIndex && (isBuilding || isValidating);
          return (
            <a className={`wz-step wz-${state}${isProcessing ? " wz-processing" : ""}`} href={`#${step.id}`} key={step.id}>
              <span className="wz-step-num">
                {state === "complete" ? (
                  <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M2 6.5L5 9.5L10 3.5" />
                  </svg>
                ) : isProcessing ? (
                  <span className="wz-spinner" />
                ) : (
                  index + 1
                )}
              </span>
              <span className="wz-step-label">{step.label}</span>
              {isProcessing && currentStageLabel ? (
                <span className="wz-step-detail">{currentStageLabel}</span>
              ) : null}
            </a>
          );
        })}
      </nav>

      {workersMissing ? (
        <div className="wz-warning">
          <strong>Workers not running.</strong> The case-builder and validation-runner workers
          do not appear to be active. Jobs will queue but never process. Start them with:
          <pre>
            <code>pnpm --filter @pilab/case-builder worker</code>
            {"\n"}
            <code>pnpm --filter @pilab/validation-runner worker</code>
          </pre>
        </div>
      ) : null}

      <div className="wz-info">
        <strong>Limited runtime support.</strong> Validation currently only supports
        Python projects with <code>pip</code> installable dependencies
        (e.g. <code>requirements.txt</code>, <code>setup.py</code>, or <code>pyproject.toml</code>).
        Node.js and other language support is coming soon.
      </div>

      <div className="wz-carousel">
        {/* ─── Step 0: Source Issue + PR ─── */}
        <div className={`wz-slide${activeStepIndex === 0 ? " wz-active" : ""}`} id="source-issue">
          <form className="wz-card" onSubmit={submitCase}>
            <div className="wz-step-h">
              <span className="wz-num">01</span>
              <h2>
                Source <em>issue</em>
              </h2>
            </div>
            <label className="wz-field">
              <span>GitHub issue URL</span>
              <input
                name="issueUrl"
                placeholder="https://github.com/owner/repo/issues/123"
                required
                type="url"
              />
            </label>
            <div className="wz-callout">
              <span className={`wz-pip ${createdCase ? "ok" : error ? "fail" : "pending"}`} />
              The wizard sends only the issue URL to the GitHub issue import endpoint.
            </div>
            {createdCase ? (
              <p className="wz-msg ok">Persisted case ID: {createdCase.id}</p>
            ) : null}
            {error ? <p className="wz-msg fail">{error}</p> : null}
            <div className="wz-actions">
              <button className="btn2 primary" disabled={isSubmitting} type="submit">
                {isSubmitting ? "Importing..." : "Import issue"}
              </button>
            </div>
          </form>

          {issue ? (
            <section className="panel wz-info-panel">
              <div className="wz-kv-grid">
                <div>
                  <dt>State</dt>
                  <dd><StatusPill status={issue.state} /></dd>
                </div>
                <div>
                  <dt>Repository</dt>
                  <dd>{issue.repoOwner}/{issue.repoName}#{issue.issueNumber}</dd>
                </div>
                <div>
                  <dt>Title</dt>
                  <dd><a href={issue.url}>{issue.title}</a></dd>
                </div>
                <div>
                  <dt>Comments</dt>
                  <dd>{issue.commentCount}</dd>
                </div>
                <div>
                  <dt>Events</dt>
                  <dd>{issue.timelineEventCount}</dd>
                </div>
                <div>
                  <dt>Issue ID</dt>
                  <dd>{issue.id}</dd>
                </div>
              </div>
              {issue.labels.length ? (
                <div className="tagList">{issue.labels.map((label) => <span key={label}>{label}</span>)}</div>
              ) : null}
            </section>
          ) : null}

          {importResult ? (
            <section className="panel wz-info-panel">
              <SectionTitle kicker="PR Discovery" title="Select a pull request" />
              {importResult.warnings.length ? (
                <div className="callout warning">
                  <strong>Discovery warnings:</strong>
                  <ul>{importResult.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
                </div>
              ) : null}

              {!selectedPr && prCandidates.length ? (
                <div className="candidateList">
                  {prCandidates.map((candidate) => (
                    <article className="candidateCard" key={candidate.url}>
                      <div>
                        <StatusPill status={candidate.status} />
                        <strong>
                          <a href={candidate.url}>
                            {candidate.repository.owner}/{candidate.repository.repo}#{candidate.pullNumber}
                          </a>
                        </strong>
                        <p>{candidate.title}</p>
                      </div>
                      <dl>
                        <div><dt>Confidence</dt><dd>{formatConfidence(candidate.confidence)}</dd></div>
                        <div><dt>Source</dt><dd>{candidate.source}</dd></div>
                        <div><dt>Author</dt><dd>{candidate.authorLogin ?? "Unknown"}</dd></div>
                      </dl>
                      {candidate.confidenceReasons.length ? (
                        <ul>{candidate.confidenceReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
                      ) : null}
                      {candidate.labels.length ? (
                        <div className="tagList">{candidate.labels.map((label) => <span key={label}>{label}</span>)}</div>
                      ) : null}
                      <div className="candidateActions">
                        <button className="button primary" disabled={isSelectingPr} onClick={() => void submitPrSelection(candidate.url)} type="button">
                          {isSelectingPr && selectingPrUrl === candidate.url ? "Selecting..." : "Select"}
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : null}

              {shouldShowPrSelection ? (
                <form className="prSelectionForm" onSubmit={handleManualPr}>
                  <label>
                    Pull request URL or number
                    <input name="prInput" placeholder={prCandidates.length ? "Override with https://github.com/owner/repo/pull/456 or 456" : "https://github.com/owner/repo/pull/456 or 456"} />
                  </label>
                  <button className="button primary" disabled={isSelectingPr} type="submit">
                    {isSelectingPr && !selectingPrUrl ? "Selecting..." : "Select PR"}
                  </button>
                </form>
              ) : null}
              {prSelectionError ? <p className="formMessage error">{prSelectionError}</p> : null}
            </section>
          ) : !issue ? (
            <div className="wz-empty-slide">
              <strong>Enter a GitHub issue URL above</strong>
              <p>The wizard will import the issue, discover fixing PRs, and begin the validation pipeline.</p>
            </div>
          ) : null}

          {selectedPr ? (
            <section className="panel wz-info-panel">
              <div className="callout">
                <StatusPill status={selectedPr.state} /> Selected {selectedPr.repoOwner}/{selectedPr.repoName}#{selectedPr.prNumber}
              </div>
              <dl className="metadataGrid compactMetadataGrid">
                <div><dt>Title</dt><dd><a href={selectedPr.url}>{selectedPr.title}</a></dd></div>
                <div><dt>Base</dt><dd>{selectedPr.baseRef} <code>{selectedPr.baseSha}</code></dd></div>
                <div><dt>Head</dt><dd>{selectedPr.headRef} <code>{selectedPr.headSha}</code></dd></div>
                <div><dt>Changed files</dt><dd>{selectedPr.changedFileCount}</dd></div>
                <div><dt>PR ID</dt><dd>{selectedPr.id}</dd></div>
                <div><dt>Merge SHA</dt><dd>{selectedPr.mergeSha ?? "None"}</dd></div>
                <div><dt>Merged at</dt><dd>{selectedPr.mergedAt ?? "Not merged"}</dd></div>
              </dl>
            </section>
          ) : null}
        </div>

        {/* ─── Step 1: Validation Pipeline ─── */}
        <div className={`wz-slide${activeStepIndex === 1 ? " wz-active" : ""}`} id="validation">
          {!caseBuilderJob && !validationRunnerJob && !proposedTestBuilderOutput && !validationRunnerOutput ? (
            <div className="wz-empty-slide">
              <strong>Validation will start automatically</strong>
              <p>Once a pull request is selected, the case builder and validation runner process the case pipeline.</p>
            </div>
          ) : (
            <div className="wz-validation-timeline">
              {caseBuilderFailed ? (
                <div className="wz-callout wz-callout-error" style={{ marginBottom: 14 }}>
                  <span className="wz-pip fail" />
                  <div>
                    <strong>Case builder failed.</strong> Validation cannot proceed until the builder succeeds. Review the error below, then select a different pull request or fix the underlying issue.
                  </div>
                </div>
              ) : null}

              {/* Case Builder Phase */}
              <div className={`wz-phase${isBuilding ? " wz-phase-active" : caseBuilderFailed ? " wz-phase-failed" : proposedTestBuilderOutput ? " wz-phase-done" : " wz-phase-pending"}`}>
                <div className="wz-phase-header">
                  <span className="wz-phase-icon">
                    {isBuilding ? <span className="wz-spinner-lg" /> : caseBuilderFailed ? "!" : proposedTestBuilderOutput ? <svg width="14" height="14" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 6.5L5 9.5L10 3.5" /></svg> : <span className="wz-pip pending" />}
                  </span>
                  <div className="wz-phase-title">
                    <strong>Case builder</strong>
                    {isBuilding && currentStageLabel && currentPhase === "build" ? (
                      <span className="wz-phase-sub">{currentStageLabel}</span>
                    ) : caseBuilderFailed ? (
                      <span className="wz-phase-sub wz-phase-sub-fail">Failed</span>
                    ) : proposedTestBuilderOutput ? (
                      <span className="wz-phase-sub">Completed</span>
                    ) : null}
                  </div>
                  {isBuilding && buildStartedAt ? (
                    <span className="wz-phase-elapsed">{formatElapsed(buildStartedAt, null)}</span>
                  ) : null}
                </div>
                {isBuilding && caseBuilderProgress ? (
                  <div className="wz-phase-detail">
                    {caseBuilderProgress.stage ? <span className="wz-stage-tag">{caseBuilderProgress.stage}</span> : null}
                    {caseBuilderProgress.message ? <p>{caseBuilderProgress.message}</p> : null}
                  </div>
                ) : null}
                {caseBuilderJob ? (
                  <div className="wz-phase-meta">
                    <span>Queue: {caseBuilderJob.queueName}</span>
                    <span>State: <StatusPill status={caseBuilderJob.state} /></span>
                    <span>Job tries: {caseBuilderJob.attemptsMade}</span>
                  </div>
                ) : null}
                {caseBuilderJob?.state === "failed" && caseBuilderJob.failedReason ? (
                  <div className="wz-callout wz-callout-error">
                    <span className="wz-pip fail" /> {caseBuilderJob.failedReason}
                  </div>
                ) : null}
                {proposedTestBuilderOutput ? (
                  <div className="wz-phase-result">
                    <div className="wz-kv-compact">
                      <span><strong>{proposedTestBuilderOutput.proposedTestCount}</strong> proposed</span>
                      <span><strong>{proposedTestBuilderOutput.failToPassCount}</strong> fail-to-pass</span>
                      <span><strong>{proposedTestBuilderOutput.passToPassCount}</strong> pass-to-pass</span>
                      <span><strong>{proposedTestBuilderOutput.verifiedArtifactCount}</strong> artifacts</span>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="wz-phase-connector" />

              {/* Validation Runner Phase */}
              <div className={`wz-phase${isValidating ? " wz-phase-active" : validationRunnerFailed ? " wz-phase-failed" : validationComplete ? " wz-phase-done" : validationSkipped ? " wz-phase-skipped" : " wz-phase-pending"}`}>
                <div className="wz-phase-header">
                  <span className="wz-phase-icon">
                    {isValidating ? <span className="wz-spinner-lg" /> : validationRunnerFailed ? "!" : validationComplete ? <svg width="14" height="14" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 6.5L5 9.5L10 3.5" /></svg> : validationSkipped ? <span>—</span> : <span className="wz-pip pending" />}
                  </span>
                  <div className="wz-phase-title">
                    <strong>Validation runner</strong>
                    {isValidating && currentStageLabel && currentPhase === "validate" ? (
                      <span className="wz-phase-sub">{currentStageLabel}</span>
                    ) : validationRunnerFailed ? (
                      <span className="wz-phase-sub wz-phase-sub-fail">Failed</span>
                    ) : validationComplete ? (
                      <span className="wz-phase-sub">{latestValidationStatus === "accepted" ? "Accepted" : latestValidationStatus === "rejected" ? "Rejected" : "Error"}</span>
                    ) : validationSkipped ? (
                      <span className="wz-phase-sub">Skipped — case builder failed</span>
                    ) : null}
                  </div>
                  {isValidating && validateStartedAt ? (
                    <span className="wz-phase-elapsed">{formatElapsed(validateStartedAt, null)}</span>
                  ) : null}
                </div>
                {isValidating && validationRunnerProgress ? (
                  <div className="wz-phase-detail">
                    {validationRunnerProgress.stage ? <span className="wz-stage-tag">{validationRunnerProgress.stage}</span> : null}
                    {validationRunnerProgress.message ? <p>{validationRunnerProgress.message}</p> : null}
                  </div>
                ) : null}
                {validationError ? (
                  <div className="wz-callout wz-callout-error">
                    <span className="wz-pip fail" /> {validationError}
                  </div>
                ) : null}
                {validationRunnerJob ? (
                  <div className="wz-phase-meta">
                    <span>State: <StatusPill status={validationRunnerJob.state} /></span>
                    <span>Job tries: {validationRunnerJob.attemptsMade}</span>
                    <span>Validation attempts: {validationAttempts.length}</span>
                    {validationRunnerJob.processedAt ? <span>Processed: {new Date(validationRunnerJob.processedAt).toLocaleTimeString()}</span> : null}
                  </div>
                ) : null}
                {validationRunnerJob?.failedReason ? (
                  <div className="wz-callout wz-callout-error">
                    <span className="wz-pip fail" /> {validationRunnerJob.failedReason}
                  </div>
                ) : null}
                {validationComplete && latestValidationStatus ? (
                  <div className="wz-phase-result">
                    <div className="wz-kv-compact">
                      <span className={`wz-result-status ${latestValidationStatus}`}>
                        {latestValidationStatus === "accepted" ? "Accepted" : latestValidationStatus === "rejected" ? "Rejected" : "Error"}
                      </span>
                      <span><strong>{latestValidationAttempt?.acceptedTestCount ?? validationRunnerOutput?.acceptedTestCount ?? 0}</strong> accepted</span>
                      <span><strong>{latestValidationAttempt?.rejectedTestCount ?? validationRunnerOutput?.rejectedTestCount ?? 0}</strong> rejected</span>
                      <span><strong>{validationAttempts.length}</strong> validation attempts</span>
                    </div>
                    {validationRunnerOutput?.rejectedTests?.length ? (
                      <div className="wz-rejected-tests">
                        {validationRunnerOutput.rejectedTests.map((test) => (
                          <div className="wz-rejected-test" key={test.testSpecId}>
                            <strong>{test.name}</strong> <span className="wz-test-kind">{test.kind}</span>
                            <ul>{test.issues.map((issue) => (
                              <li key={issue.code}>
                                <span className={`issueSeverity ${issue.severity}`}>{issue.severity}</span>{" "}
                                <code>{issue.code}</code>: {issue.message}
                              </li>
                            ))}</ul>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {validationLogArtifacts.length ? (
                      <div className="wz-log-artifacts">
                        {validationLogArtifacts.map(([label, artifact]) => (
                          <span key={String(artifact.id)} className="wz-log-artifact">{label} log: <code>{artifact.objectKey}</code> ({formatByteSize(artifact.byteSize)} bytes)</span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {!proposedTestBuilderOutput && !validationRunnerJob && !validationRunnerOutput && caseBuilderJob && !isTerminalJobState(caseBuilderJob?.state ?? "") ? (
                  <div className="wz-callout">
                    <span className="wz-pip pending" /> Waiting for builder to complete before validation starts…
                  </div>
                ) : null}
              </div>

              {validationAttempts.length ? (
                <div className="tableWrap">
                  <div className="wz-callout" style={{ marginBottom: "0.5rem" }}>
                    <strong>Test-generation attempt {latestValidationAttempt?.attemptNumber ?? 1} of 3</strong>
                    {evaluatorStrategy === "llm_evaluator_only"
                      ? " — exhausted; case will use the LLM evaluator at benchmark time."
                      : evaluatorStrategy === "deterministic_tests"
                        ? " — validated; tests will score solutions deterministically."
                        : null}
                  </div>
                  <table>
                    <thead>
                      <tr><th>Attempt</th><th>Status</th><th>Accepted</th><th>Rejected</th><th>Runner</th></tr>
                    </thead>
                    <tbody>
                      {validationAttempts.map((attempt) => (
                        <tr key={attempt.id}>
                          <td>{attempt.attemptNumber}</td>
                          <td><StatusPill status={attempt.status} /></td>
                          <td>{attempt.acceptedTestCount}</td>
                          <td>{attempt.rejectedTestCount}</td>
                          <td><code>{attempt.runnerVersion}</code></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}

              {evaluatorStrategy === "llm_evaluator_only" ? (
                <div className="wz-swe-entry">
                  <div className="callout">
                    <StatusPill status="llm evaluator only" /> Deterministic test generation exhausted its attempts.
                    At benchmark time, a Pi-evaluator agent will score each agent's solution against the gold patch.
                  </div>
                </div>
              ) : null}
              {evaluatorStrategy === "deterministic_tests" ? (
                <div className="wz-swe-entry">
                  <div className="callout">
                    <StatusPill status="deterministic tests" /> Validated fail-to-pass / pass-to-pass tests will score
                    each agent's solution at benchmark time.
                  </div>
                </div>
              ) : null}

              {/* SWE-bench entry, artifacts, changed files — hidden when builder failed to reduce noise */}
              {!caseBuilderFailed ? (
                <>
                  {sweBenchStyleEntry ? (
                    <div className="wz-swe-entry">
                      <div className="callout">
                        <StatusPill status="swe-bench style" /> Entry seeded from the imported issue and selected PR.
                      </div>
                      <dl className="metadataGrid compactMetadataGrid">
                        <div><dt>Instance ID</dt><dd><code>{sweBenchStyleEntry.instanceId}</code></dd></div>
                        <div><dt>Repo</dt><dd>{sweBenchStyleEntry.repo}</dd></div>
                        <div><dt>Issue</dt><dd><a href={sweBenchStyleEntry.issueUrl}>#{sweBenchStyleEntry.issueNumber}</a></dd></div>
                        <div><dt>PR</dt><dd><a href={sweBenchStyleEntry.prUrl}>#{sweBenchStyleEntry.pullNumber}</a></dd></div>
                        <div><dt>Base commit</dt><dd><code>{sweBenchStyleEntry.baseCommit}</code></dd></div>
                        <div><dt>Gold commit</dt><dd><code>{sweBenchStyleEntry.goldCommit}</code></dd></div>
                        <div><dt>Patch source</dt><dd>{sweBenchStyleEntry.patchSource}</dd></div>
                        <div><dt>Test source</dt><dd>{sweBenchStyleEntry.testSource}</dd></div>
                        <div><dt>FAIL_TO_PASS</dt><dd>{proposedTestBuilderOutput?.failToPassCount ?? sweBenchStyleEntry.failToPass.length}</dd></div>
                        <div><dt>PASS_TO_PASS</dt><dd>{proposedTestBuilderOutput?.passToPassCount ?? sweBenchStyleEntry.passToPass.length}</dd></div>
                      </dl>
                    </div>
                  ) : null}

                  {artifacts.length ? (
                    <div className="tableWrap">
                      <table>
                        <thead>
                          <tr><th>Kind</th><th>Object key</th><th>SHA-256</th><th>Bytes</th><th>ID</th></tr>
                        </thead>
                        <tbody>
                          {artifacts.map((artifact) => (
                            <tr key={artifact.id}>
                              <td><strong>{artifact.kind}</strong></td>
                              <td><code>{artifact.objectKey}</code></td>
                              <td><code>{artifact.sha256}</code></td>
                              <td>{formatByteSize(artifact.byteSize)}</td>
                              <td><code>{artifact.id}</code></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}

                  {selectedPrResult?.changedFiles.length ? (
                    <div className="tableWrap">
                      <table>
                        <thead>
                          <tr><th>Filename</th><th>Status</th><th>Additions</th><th>Deletions</th><th>Changes</th></tr>
                        </thead>
                        <tbody>
                          {selectedPrResult.changedFiles.map((file) => (
                            <tr key={file.filename}>
                              <td><strong>{file.filename}</strong></td>
                              <td>{file.status}</td>
                              <td>{file.additions}</td>
                              <td>{file.deletions}</td>
                              <td>{file.changes}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>
          )}
        </div>

        {/* ─── Step 2: Review & Actions ─── */}
        <div className={`wz-slide${activeStepIndex === 2 ? " wz-active" : ""}`} id="review-actions">
          {validationComplete ? (
            <div className="wz-review-content">
              <div className="wz-review-summary">
                <div className={`wz-review-outcome ${validationRunnerOutput?.status === "accepted" ? "ok" : "warn"}`}>
                  <span className="wz-review-icon">
                    {validationRunnerOutput?.status === "accepted" ? (
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12.5L9.5 17L19 7.5" /></svg>
                    ) : (
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 9v4m0 4h.01M3 12a9 9 0 1118 0 9 9 0 01-18 0z" /></svg>
                    )}
                  </span>
                  <div>
                    <h3>
                      {validationRunnerOutput?.status === "accepted" ? "Validation accepted" : "Validation rejected"}
                    </h3>
                    <p>
                      {validationRunnerOutput?.acceptedTestCount ?? 0} accepted,{" "}
                      {validationRunnerOutput?.rejectedTestCount ?? 0} rejected tests.
                    </p>
                  </div>
                </div>
              </div>

              {frozenCase ? (
                <div className="formMessage success">
                  Case frozen successfully. <a href={`/cases/${frozenCase.id}`}>View case details</a>
                </div>
              ) : rejectedCase ? (
                <div className="formMessage rejected">
                  Case rejected successfully. <a href={`/cases/${rejectedCase.id}`}>View case details</a>
                </div>
              ) : (
                <div className="wz-review-actions">
                  <button
                    className="btn2 primary"
                    disabled={
                      isFreezing ||
                      isRejecting ||
                      (validationRunnerOutput?.acceptedTestCount ?? 0) === 0
                    }
                    onClick={() => void handleFreezeCase()}
                    type="button"
                  >
                    {isFreezing ? "Freezing..." : "Freeze case"}
                  </button>
                  <button
                    className="btn2"
                    disabled={isFreezing || isRejecting}
                    onClick={() => void handleRejectCase()}
                    type="button"
                  >
                    {isRejecting ? "Rejecting..." : "Reject case"}
                  </button>
                </div>
              )}
              {caseActionError ? <p className="formMessage error">{caseActionError}</p> : null}
            </div>
          ) : (
            <div className="wz-empty-slide">
              <strong>Waiting for validation</strong>
              <p>Once the validation runner finishes, you can freeze or reject the case here.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ kicker, title }: { kicker: string; title: string }) {
  return (
    <div className="sectionTitle">
      <span>{kicker}</span>
      <h2>{title}</h2>
    </div>
  );
}
