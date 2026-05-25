"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CaseVersionDetail, GitHubCase, WorkersStatus } from "../../lib/api";
import { freezeCase, getCaseVersionDetail, getWorkersStatus, rejectCase } from "../../lib/api";
import { computeWorkflow } from "./compute-workflow";
import type {
  CaseBuildActions,
  CaseBuildSnapshot,
  CaseBuilderJobSummary,
  ImportIssueResponse,
  ProposedTestBuilderOutput,
  SelectPrResponse,
  ValidationRunnerJobSummary,
  WorkflowNodeId,
} from "./types";

export function useCaseBuildState(): CaseBuildSnapshot & CaseBuildActions {
  const [importResult, setImportResult] = useState<ImportIssueResponse | null>(null);
  const [importError, setImportError] = useState<string | undefined>(undefined);
  const [isSubmittingImport, setIsSubmittingImport] = useState(false);
  const [selectedPrResult, setSelectedPrResult] = useState<SelectPrResponse | null>(null);
  const [prSelectionError, setPrSelectionError] = useState<string | undefined>(undefined);
  const [isSelectingPr, setIsSelectingPr] = useState(false);
  const [validationRunnerJob, setValidationRunnerJob] = useState<ValidationRunnerJobSummary | null>(null);
  const [validationError, setValidationError] = useState<string | undefined>(undefined);
  const [caseVersionDetail, setCaseVersionDetail] = useState<CaseVersionDetail | null>(null);
  const [caseActionError, setCaseActionError] = useState<string | undefined>(undefined);
  const [isFreezing, setIsFreezing] = useState(false);
  const [isRejecting, setIsRejecting] = useState(false);
  const [frozenCase, setFrozenCase] = useState<GitHubCase | null>(null);
  const [rejectedCase, setRejectedCase] = useState<GitHubCase | null>(null);
  const [workersStatus, setWorkersStatus] = useState<WorkersStatus | null>(null);
  const [validationPollCount, setValidationPollCount] = useState(0);
  const [activeNodeOverride, setActiveNodeOverride] = useState<WorkflowNodeId | null>(null);

  // ── Workers status (10s) ────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      void getWorkersStatus()
        .then((status) => {
          if (!cancelled) setWorkersStatus(status);
        })
        .catch(() => {});
    };
    tick();
    const interval = window.setInterval(tick, 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  // ── Case-builder job (2s while not terminal) ────────────────────
  useEffect(() => {
    const job = selectedPrResult?.caseBuilderJob;
    if (!job || isTerminalJobState(job.state)) return;

    let cancelled = false;
    const interval = window.setInterval(() => {
      void fetchCaseBuilderJob(job.id)
        .then((latest) => {
          if (cancelled) return;
          setSelectedPrResult((current) =>
            current ? { ...current, caseBuilderJob: latest } : current,
          );
        })
        .catch((err) => {
          if (!cancelled) {
            setPrSelectionError(err instanceof Error ? err.message : "Unable to refresh case-builder job");
          }
        });
    }, 2_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [selectedPrResult?.caseBuilderJob?.id, selectedPrResult?.caseBuilderJob?.state]);

  // ── Validation-runner job (2s, derived from build's returnvalue) ─
  const validationRunnerJobRef = useRef<ValidationRunnerJobSummary | null>(null);
  useEffect(() => {
    validationRunnerJobRef.current = validationRunnerJob;
  }, [validationRunnerJob]);

  useEffect(() => {
    const proposed = getProposedTestBuilderOutput(selectedPrResult?.caseBuilderJob?.returnvalue ?? null);
    const validationJobId = proposed?.validationJobId;
    if (!validationJobId) {
      setValidationRunnerJob(null);
      return;
    }
    let cancelled = false;
    const refresh = () => {
      void fetchValidationRunnerJob(validationJobId)
        .then((latest) => {
          if (cancelled) return;
          setValidationRunnerJob(latest);
          setValidationPollCount((c) => c + 1);
        })
        .catch((err) => {
          if (cancelled) return;
          if (err instanceof Error && err.message.includes("404")) return;
          setValidationError(err instanceof Error ? err.message : "Unable to refresh validation-runner job");
        });
    };
    refresh();
    const interval = window.setInterval(() => {
      const current = validationRunnerJobRef.current;
      if (!current || !isTerminalJobState(current.state)) refresh();
    }, 2_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [selectedPrResult?.caseBuilderJob?.returnvalue]);

  // ── Case version detail (4s) ────────────────────────────────────
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
          if (!cancelled) setCaseVersionDetail(detail);
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

  // ── Actions ─────────────────────────────────────────────────────
  const importIssue = useCallback(async (issueUrl: string) => {
    setImportError(undefined);
    setImportResult(null);
    setSelectedPrResult(null);
    setCaseVersionDetail(null);
    setValidationRunnerJob(null);
    setPrSelectionError(undefined);
    setValidationError(undefined);
    setValidationPollCount(0);
    setActiveNodeOverride(null);
    setIsSubmittingImport(true);
    const parsed = parseGitHubIssueUrl(issueUrl);
    if (!parsed) {
      setImportError("Enter a GitHub issue URL like https://github.com/owner/repo/issues/123");
      setIsSubmittingImport(false);
      return;
    }
    try {
      const result = await importGitHubIssue(parsed.issueUrl);
      setImportResult(result);
      // Auto-select the lone PR candidate when unambiguous.
      if (result.prCandidates.length === 1 && !result.needsPrSelection) {
        const candidate = result.prCandidates[0]!;
        try {
          const prResult = await selectPullRequest(result.case.id, candidate.url);
          setSelectedPrResult(prResult);
          setImportResult((c) => (c ? { ...c, case: prResult.case, needsPrSelection: false } : c));
        } catch (err) {
          setPrSelectionError(err instanceof Error ? err.message : "Auto-select PR failed");
        }
      }
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Unable to import issue");
    } finally {
      setIsSubmittingImport(false);
    }
  }, []);

  const selectPr = useCallback(
    async (input: string) => {
      const caseId = importResult?.case.id;
      if (!caseId) {
        setPrSelectionError("Import an issue before selecting a PR.");
        return;
      }
      const trimmed = input.trim();
      if (!trimmed) {
        setPrSelectionError("Enter a pull request URL or number.");
        return;
      }
      setPrSelectionError(undefined);
      setValidationError(undefined);
      setIsSelectingPr(true);
      try {
        const prResult = await selectPullRequest(caseId, trimmed);
        setSelectedPrResult(prResult);
        setImportResult((c) => (c ? { ...c, case: prResult.case, needsPrSelection: false } : c));
      } catch (err) {
        setPrSelectionError(err instanceof Error ? err.message : "PR selection failed");
      } finally {
        setIsSelectingPr(false);
      }
    },
    [importResult?.case.id],
  );

  const freeze = useCallback(async () => {
    const caseId = selectedPrResult?.case.id ?? importResult?.case.id;
    if (!caseId) return;
    setCaseActionError(undefined);
    setIsFreezing(true);
    try {
      const result = await freezeCase(String(caseId));
      setFrozenCase(result);
    } catch (err) {
      setCaseActionError(err instanceof Error ? err.message : "Freeze failed");
    } finally {
      setIsFreezing(false);
    }
  }, [importResult?.case.id, selectedPrResult?.case.id]);

  const reject = useCallback(async () => {
    const caseId = selectedPrResult?.case.id ?? importResult?.case.id;
    if (!caseId) return;
    setCaseActionError(undefined);
    setIsRejecting(true);
    try {
      const result = await rejectCase(String(caseId));
      setRejectedCase(result);
    } catch (err) {
      setCaseActionError(err instanceof Error ? err.message : "Reject failed");
    } finally {
      setIsRejecting(false);
    }
  }, [importResult?.case.id, selectedPrResult?.case.id]);

  const setActiveNode = useCallback((id: WorkflowNodeId) => {
    setActiveNodeOverride(id);
  }, []);

  // ── Derived workflow state ──────────────────────────────────────
  const workflow = useMemo(() => {
    const state = computeWorkflow({
      importResult,
      selectedPrResult,
      caseVersionDetail,
      caseBuilderJob: selectedPrResult?.caseBuilderJob ?? null,
      validationRunnerJob,
      frozenCase,
      rejectedCase,
      isSubmittingImport,
      isSelectingPr,
      isFreezing,
      isRejecting,
      ...(importError ? { importError } : {}),
      ...(prSelectionError ? { prSelectionError } : {}),
      ...(validationError ? { validationError } : {}),
      ...(caseActionError ? { caseActionError } : {}),
    });
    if (activeNodeOverride) {
      // Only honor the override if that node actually exists in the current DAG.
      const exists = state.nodes.some((n) => n.id === activeNodeOverride);
      if (exists) return { ...state, activeNodeId: activeNodeOverride };
    }
    return state;
  }, [
    importResult,
    selectedPrResult,
    caseVersionDetail,
    validationRunnerJob,
    frozenCase,
    rejectedCase,
    isSubmittingImport,
    isSelectingPr,
    isFreezing,
    isRejecting,
    importError,
    prSelectionError,
    validationError,
    caseActionError,
    activeNodeOverride,
  ]);

  const errors = useMemo(() => {
    const collected: CaseBuildSnapshot["errors"] = {};
    if (importError) collected.import = importError;
    if (prSelectionError) collected.prSelection = prSelectionError;
    if (validationError) collected.validation = validationError;
    if (caseActionError) collected.caseAction = caseActionError;
    return collected;
  }, [importError, prSelectionError, validationError, caseActionError]);

  return {
    workflow,
    importResult,
    selectedPrResult,
    caseVersionDetail,
    caseBuilderJob: selectedPrResult?.caseBuilderJob ?? null,
    validationRunnerJob,
    frozenCase,
    rejectedCase,
    workersStatus,
    errors,
    isSubmittingImport,
    isSelectingPr,
    isFreezing,
    isRejecting,
    importIssue,
    selectPr,
    freeze,
    reject,
    setActiveNode,
  };
}

// ── API helpers (private; mirror the previous page.tsx helpers) ───────

async function importGitHubIssue(issueUrl: string): Promise<ImportIssueResponse> {
  const response = await fetch("/api/github/cases/import-issue", {
    body: JSON.stringify({ issueUrl }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  if (!response.ok) {
    throw new Error((await readApiErrorMessage(response)) || `Import failed with ${response.status}`);
  }
  return response.json() as Promise<ImportIssueResponse>;
}

async function selectPullRequest(caseId: string | number, input: string): Promise<SelectPrResponse> {
  const trimmed = input.trim();
  const numericPr = /^\d+$/.test(trimmed) ? Number(trimmed) : null;
  const response = await fetch(`/api/github/cases/${encodeURIComponent(String(caseId))}/select-pr`, {
    body: JSON.stringify(numericPr === null ? { prUrl: trimmed } : { prNumber: numericPr }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  if (!response.ok) {
    throw new Error((await readApiErrorMessage(response)) || `PR selection failed with ${response.status}`);
  }
  return response.json() as Promise<SelectPrResponse>;
}

async function fetchCaseBuilderJob(jobId: string | number): Promise<CaseBuilderJobSummary> {
  const response = await fetch(`/api/case-builder/jobs/${encodeURIComponent(String(jobId))}`);
  if (!response.ok) {
    throw new Error((await readApiErrorMessage(response)) || `Case-builder job lookup failed with ${response.status}`);
  }
  return response.json() as Promise<CaseBuilderJobSummary>;
}

async function fetchValidationRunnerJob(jobId: string | number): Promise<ValidationRunnerJobSummary> {
  const response = await fetch(`/api/validation-runner/jobs/${encodeURIComponent(String(jobId))}`);
  if (!response.ok) {
    throw new Error((await readApiErrorMessage(response)) || `Validation-runner job lookup failed with ${response.status}`);
  }
  return response.json() as Promise<ValidationRunnerJobSummary>;
}

async function readApiErrorMessage(response: Response): Promise<string> {
  const fallback = `Request failed with ${response.status}`;
  const ct = response.headers.get("content-type") ?? "";
  try {
    if (ct.includes("application/json")) {
      const payload = (await response.json()) as unknown;
      const msg = extractApiErrorMessage(payload);
      return truncate(msg ?? fallback, 220);
    }
    const text = await response.text();
    return truncate(text || fallback, 220);
  } catch {
    return fallback;
  }
}

function extractApiErrorMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const r = payload as Record<string, unknown>;
  for (const key of ["message", "error", "detail"]) {
    const v = r[key];
    if (typeof v === "string" && v.trim()) return v;
  }
  return null;
}

function truncate(s: string, max: number): string {
  const n = s.replace(/\s+/g, " ").trim();
  return n.length <= max ? n : `${n.slice(0, max - 3)}...`;
}

function parseGitHubIssueUrl(value: string): { issueUrl: string } | null {
  try {
    const url = new URL(value);
    const segments = url.pathname.split("/").filter(Boolean);
    const [owner, repo, type, num] = segments;
    if (url.hostname !== "github.com" || !owner || !repo || type !== "issues" || !num) return null;
    return { issueUrl: url.toString() };
  } catch {
    return null;
  }
}

function isTerminalJobState(state: string): boolean {
  return state === "completed" || state === "failed" || state === "cancelled";
}

function getProposedTestBuilderOutput(returnvalue: unknown): ProposedTestBuilderOutput | null {
  if (!returnvalue || typeof returnvalue !== "object" || Array.isArray(returnvalue)) return null;
  const v = returnvalue as Record<string, unknown>;
  if (v.stage !== "ready-for-validation") return null;
  if (typeof v.caseId !== "string" && typeof v.caseId !== "number") return null;
  if (typeof v.caseVersionId !== "string" && typeof v.caseVersionId !== "number") return null;
  if (typeof v.validationJobId !== "string" && typeof v.validationJobId !== "number") return null;
  return v as unknown as ProposedTestBuilderOutput;
}
