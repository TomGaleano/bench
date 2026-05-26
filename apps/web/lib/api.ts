export type GitHubCaseCreateRequest = {
  title: string;
  body?: string;
  labels?: string[];
  runId?: string;
  metadata?: Record<string, unknown>;
};

export type CaseStatus =
  | "draft"
  | "building"
  | "ready"
  | "frozen"
  | "rejected"
  | "archived";

export type GitHubCase = {
  id: string;
  title: string;
  body: string;
  labels: string[];
  runId?: string;
  metadata: Record<string, unknown>;
  status: CaseStatus;
  externalUrl: string | null;
  createdAt: string;
  updatedAt: string;
  frozenAt: string | null;
};

export type RunSummary = {
  id: string;
  caseVersionId: string | null;
  mode: string;
  status: string;
  modelId: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  eventCount: number;
  plan?: {
    id: string;
    markdown: string | null;
    artifact: {
      id: string;
      kind: string;
      objectKey: string;
      byteSize: number | null;
      contentType: string | null;
    } | null;
  } | null;
  gradingStatus?: {
    plan?: { jobId: string; state: string } | null;
    implementation?: { jobId: string; state: string } | null;
    external?: { jobId: string; state: string } | null;
  };
};

export type DurableRunEvent = {
  id: string;
  runId: string;
  seq: number;
  timestamp: string;
  stage: string;
  kind: string;
  payload: unknown;
};

function getApiBaseUrl(): string {
  if (typeof window === "undefined") {
    return process.env.API_BASE_URL ?? "http://localhost:3001";
  }

  return "/api";
}

export async function createGitHubCase(payload: GitHubCaseCreateRequest) {
  const response = await fetch(`${getApiBaseUrl()}/github/cases`, {
    body: JSON.stringify(payload),
    headers: {
      "Content-Type": "application/json"
    },
    method: "POST"
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `API request failed with ${response.status}`);
  }

  return response.json() as Promise<GitHubCase>;
}

export async function listRuns() {
  const response = await fetch(`${getApiBaseUrl()}/runs`, { cache: "no-store" });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `API request failed with ${response.status}`);
  }

  return response.json() as Promise<RunSummary[]>;
}

export async function getRun(runId: string) {
  const response = await fetch(`${getApiBaseUrl()}/runs/${runId}`, { cache: "no-store" });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `API request failed with ${response.status}`);
  }

  return response.json() as Promise<RunSummary>;
}

export async function getRunEvents(runId: string) {
  const response = await fetch(`${getApiBaseUrl()}/runs/${runId}/events`, { cache: "no-store" });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `API request failed with ${response.status}`);
  }

  return response.json() as Promise<DurableRunEvent[]>;
}

export async function listCases() {
  const response = await fetch(`${getApiBaseUrl()}/github/cases`, { cache: "no-store" });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `API request failed with ${response.status}`);
  }

  return response.json() as Promise<GitHubCase[]>;
}

export async function getCase(caseId: string) {
  const response = await fetch(`${getApiBaseUrl()}/github/cases/${encodeURIComponent(caseId)}`, { cache: "no-store" });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `API request failed with ${response.status}`);
  }

  return response.json() as Promise<GitHubCase>;
}

export async function getCaseVersions(caseId: string) {
  const response = await fetch(`${getApiBaseUrl()}/github/cases/${encodeURIComponent(caseId)}/versions`, { cache: "no-store" });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `API request failed with ${response.status}`);
  }

  return response.json() as Promise<Array<{ id: string; version: number; status: string; createdAt: string }>>;
}

export type TestSpecSummary = {
  id: string;
  name: string;
  kind: string;
  status: string;
  filePath: string | null;
  testCommand: string;
  expectedFailureMode: string | null;
  expectedPassMode: string | null;
  content: string | null;
  createdAt: string;
};

export type ValidationAttemptSummary = {
  id: string;
  status: string;
  attemptNumber: number;
  strategy: string;
  previousAttemptId: string | null;
  acceptedTestCount: number;
  rejectedTestCount: number;
  runnerVersion: string;
  baseLogArtifactId: string | null;
  goldLogArtifactId: string | null;
  candidateTestsArtifactId: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

export type EvaluatorStrategy = "deterministic_tests" | "llm_evaluator_only";

export type CaseVersionDetail = {
  id: string;
  caseId: string;
  version: number;
  status: string;
  evaluatorStrategy: EvaluatorStrategy | null;
  repoOwner: string;
  repoName: string;
  baseCommitSha: string;
  goldCommitSha: string | null;
  testBuilderModelId: string | null;
  validationRunnerVersion: string | null;
  createdAt: string;
  frozenAt: string | null;
  testSpecs: TestSpecSummary[];
  validationAttempts: ValidationAttemptSummary[];
};

export async function getCaseVersionDetail(caseId: string, versionId: string) {
  const response = await fetch(
    `${getApiBaseUrl()}/github/cases/${encodeURIComponent(caseId)}/versions/${encodeURIComponent(versionId)}`,
    { cache: "no-store" },
  );

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `API request failed with ${response.status}`);
  }

  return response.json() as Promise<CaseVersionDetail>;
}

export async function freezeCase(caseId: string) {
  const response = await fetch(`${getApiBaseUrl()}/github/cases/${encodeURIComponent(caseId)}/freeze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Freeze failed with ${response.status}`);
  }

  return response.json() as Promise<GitHubCase>;
}

export async function rejectCase(caseId: string) {
  const response = await fetch(`${getApiBaseUrl()}/github/cases/${encodeURIComponent(caseId)}/reject`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Reject failed with ${response.status}`);
  }

  return response.json() as Promise<GitHubCase>;
}

export type ModelInfo = {
  id: string;
  name: string;
  provider: string;
  description?: string;
  releasedAt?: number;
  modality?: string;
  contextWindow?: number;
  inputUsdPer1M?: number;
  outputUsdPer1M?: number;
  supportsToolCalling: boolean;
  supportsStructuredOutputs: boolean;
};

export type DatasetSummary = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  status: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  caseCount: number;
};

export type DatasetDetail = {
  dataset: {
    id: string;
    slug: string;
    name: string;
    description: string | null;
    status: string;
    tags: string[];
    metadata: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
  };
  cases: Array<{
    id: string;
    slug: string;
    title: string;
    status: string;
    repo: string;
  }>;
};

export type QueueStatus = {
  queueName: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: number;
  hasWorkers: boolean;
};

export type WorkersStatus = {
  caseBuilder: QueueStatus;
  validationRunner: QueueStatus;
};

export async function getWorkersStatus() {
  const response = await fetch(`${getApiBaseUrl()}/workers/status`, { cache: "no-store" });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `API request failed with ${response.status}`);
  }

  return response.json() as Promise<WorkersStatus>;
}

export type CaseRunResult = {
  runId: string;
  caseVersionId: string | null;
  modelId: string | null;
  mode: string;
  status: string;
  chargedCost: number | null;
  computedCost: number | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
};

export type CaseResultsPayload = {
  caseId: string;
  versions: number;
  results: CaseRunResult[];
};

export async function getCaseResults(caseId: string) {
  const response = await fetch(
    `${getApiBaseUrl()}/github/cases/${encodeURIComponent(caseId)}/results`,
    { cache: "no-store" },
  );
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `API request failed with ${response.status}`);
  }
  return response.json() as Promise<CaseResultsPayload>;
}

export type KpiCellPayload = {
  value: number;
  modelId: string | null;
  deltaWeekPct: number;
  spark: number[];
};

export type ActiveExperimentPayload = {
  id: string;
  name: string;
  modelsCount: number;
  tasksCount: number;
  harness: string | null;
  done: number;
  failed: number;
  active: number;
  queued: number;
  spentUsd: number;
  budgetUsd: number | null;
  elapsedMs: number;
} | null;

export type LeaderboardRow = {
  rank: number;
  modelId: string;
  harness: string | null;
  plan: number;
  impl: number;
  e2e: number;
  costPerTask: number;
  costPerResolved: number;
  trend6w: number[];
  deltaWeekPct: number;
};

export type MetricsOverview = {
  retrievedAt: string;
  kpis: {
    bestE2E: KpiCellPayload;
    bestPlan: KpiCellPayload;
    lowestCostPerResolved: KpiCellPayload;
    runs7d: KpiCellPayload;
  };
  activeExperiment: ActiveExperimentPayload;
  race: Array<{ modelId: string; short: string; trend: number[] }>;
  scatter: Array<{ modelId: string; costPerResolved: number; e2e: number }>;
  leaderboard: LeaderboardRow[];
};

export async function getMetricsOverview() {
  const response = await fetch(`${getApiBaseUrl()}/metrics/overview`, { cache: "no-store" });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `API request failed with ${response.status}`);
  }
  return response.json() as Promise<MetricsOverview>;
}

// Playground API types
export type PlaygroundStartRequest = {
  prompt: string;
  models: Array<{ id: string; name: string }>;
  graderModelId?: string | undefined;
  maxWallClockSeconds?: number;
  maxOutputTokensPerAgent?: number;
  tools?: string[];
  sandboxImage?: "py" | "node" | "py-node" | "custom";
  seedPromptText?: string;
  runTwiceAndAverage?: boolean;
};

export type PlaygroundAgentRunResponse = {
  id: string;
  modelId: string;
  modelName: string;
  status: string;
  sandboxId: string | null;
  appUrl: string | null;
  output: string | null;
  score: number | null;
  scoreRationale: string | null;
  scoreCorrectness: number | null;
  scoreCodeQuality: number | null;
  scoreUx: number | null;
  scoreShipIt: number | null;
  fileCount: number | null;
  loc: number | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

export type PlaygroundAutograderScoreRow = {
  agentRunId: string;
  overall: number | null;
  correctness: number | null;
  codeQuality: number | null;
  ux: number | null;
  shipIt: number | null;
  rationale: string | null;
};

export type PlaygroundAutograderRunResponse = {
  id: string;
  graderModelId: string;
  status: string;
  latencyMs: number | null;
  usdCost: string | null;
  errorMessage: string | null;
  createdAt: string;
  finishedAt: string | null;
  scores: PlaygroundAutograderScoreRow[];
};

export type PlaygroundSessionResponse = {
  id: string;
  prompt: string;
  status: string;
  gradingMode: string | null;
  graderModelId: string | null;
  createdAt: string;
  completedAt: string | null;
  saved: boolean;
  title: string | null;
  tags: string[];
  shareToken: string | null;
  agentRuns: PlaygroundAgentRunResponse[];
};

export type PlaygroundLeaderboardRow = {
  modelId: string;
  modelName: string;
  sessionsPlayed: number;
  avgScore: number | null;
  winRate: number | null;
};

export type PlaygroundLeaderboardResponse = {
  window: "7d" | "30d" | "90d";
  rows: PlaygroundLeaderboardRow[];
};

export type PlaygroundHistoryFilters = {
  model?: string;
  tag?: string;
  starred?: boolean;
  minScore?: number;
  from?: string;
  to?: string;
  limit?: number;
};

export async function listPlaygroundHistory(filters: PlaygroundHistoryFilters = {}) {
  const qs = new URLSearchParams();
  if (filters.model) qs.set("model", filters.model);
  if (filters.tag) qs.set("tag", filters.tag);
  if (filters.starred !== undefined) qs.set("starred", String(filters.starred));
  if (filters.minScore != null) qs.set("minScore", String(filters.minScore));
  if (filters.from) qs.set("from", filters.from);
  if (filters.to) qs.set("to", filters.to);
  if (filters.limit) qs.set("limit", String(filters.limit));
  const url = `${getApiBaseUrl()}/playground${qs.toString() ? `?${qs.toString()}` : ""}`;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `API request failed with ${response.status}`);
  }
  return response.json() as Promise<PlaygroundSessionResponse[]>;
}

export async function getPlaygroundLeaderboard(window: "7d" | "30d" | "90d" = "90d") {
  const response = await fetch(
    `${getApiBaseUrl()}/playground/leaderboard?window=${window}`,
    { cache: "no-store" },
  );
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `API request failed with ${response.status}`);
  }
  return response.json() as Promise<PlaygroundLeaderboardResponse>;
}

export async function patchPlaygroundSession(
  sessionId: string,
  patch: { title?: string | null; tags?: string[]; saved?: boolean; shareEnabled?: boolean },
) {
  const response = await fetch(`${getApiBaseUrl()}/playground/${sessionId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `API request failed with ${response.status}`);
  }
  return response.json() as Promise<PlaygroundSessionResponse>;
}

export async function getSharedPlaygroundSession(token: string) {
  const response = await fetch(`${getApiBaseUrl()}/playground/share/${token}`, { cache: "no-store" });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `API request failed with ${response.status}`);
  }
  return response.json() as Promise<PlaygroundSessionResponse>;
}

export type PlaygroundEventResponse = {
  id: string;
  agentRunId: string;
  seq: number;
  timestamp: string;
  kind: string;
  payload: unknown;
};

export async function startPlayground(payload: PlaygroundStartRequest) {
  const response = await fetch(`${getApiBaseUrl()}/playground/start`, {
    body: JSON.stringify(payload),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `API request failed with ${response.status}`);
  }

  return response.json() as Promise<PlaygroundSessionResponse>;
}

export async function listPlaygroundSessions() {
  const response = await fetch(`${getApiBaseUrl()}/playground`, { cache: "no-store" });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `API request failed with ${response.status}`);
  }

  return response.json() as Promise<PlaygroundSessionResponse[]>;
}

export async function getPlaygroundSession(sessionId: string) {
  const response = await fetch(`${getApiBaseUrl()}/playground/${sessionId}`, { cache: "no-store" });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `API request failed with ${response.status}`);
  }

  return response.json() as Promise<PlaygroundSessionResponse>;
}

export async function getPlaygroundEvents(sessionId: string, agentRunId?: string) {
  const url = new URL(`${getApiBaseUrl()}/playground/${sessionId}/events`, typeof window === "undefined" ? "http://placeholder" : window.location.href);
  if (agentRunId) url.searchParams.set("agentRunId", agentRunId);

  const response = await fetch(url.toString().replace("http://placeholder", ""), { cache: "no-store" });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `API request failed with ${response.status}`);
  }

  return response.json() as Promise<PlaygroundEventResponse[]>;
}

export function openPlaygroundEventStream(
  sessionId: string,
  onEvent: (event: PlaygroundEventResponse) => void,
  options?: { onConnected?: () => void; onClose?: () => void; onError?: (e: Event) => void },
): WebSocket {
  if (typeof window === "undefined") {
    throw new Error("openPlaygroundEventStream is browser-only");
  }
  const httpBase = getApiBaseUrl(); // "/api" in browser
  const wsProto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${wsProto}//${window.location.host}${httpBase}/playground/${sessionId}/stream`;
  const ws = new WebSocket(wsUrl);

  ws.addEventListener("message", (msg) => {
    try {
      const data = JSON.parse(msg.data) as { type?: string; event?: { payload?: Record<string, unknown> } };
      if (data.type === "connected") {
        options?.onConnected?.();
        return;
      }
      if (data.type !== "playground.event") return;
      const wrapper = data.event?.payload;
      if (!wrapper || typeof wrapper !== "object") return;
      const w = wrapper as Record<string, unknown>;
      if (w.source !== "playground") return;
      const inner: PlaygroundEventResponse = {
        id: String(w.eventId),
        agentRunId: String(w.agentRunId),
        seq: Number(w.seq),
        timestamp: String(w.timestamp),
        kind: String(w.kind),
        payload: w.payload,
      };
      onEvent(inner);
    } catch {
      // ignore malformed frames
    }
  });
  if (options?.onClose) ws.addEventListener("close", options.onClose);
  if (options?.onError) ws.addEventListener("error", options.onError);
  return ws;
}

export async function savePlaygroundSession(sessionId: string) {
  const response = await fetch(`${getApiBaseUrl()}/playground/${sessionId}/save`, { method: "POST" });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `API request failed with ${response.status}`);
  }
  return response.json() as Promise<{ saved: boolean }>;
}

export async function unsavePlaygroundSession(sessionId: string) {
  const response = await fetch(`${getApiBaseUrl()}/playground/${sessionId}/unsave`, { method: "POST" });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `API request failed with ${response.status}`);
  }
  return response.json() as Promise<{ saved: boolean }>;
}

export async function releasePlaygroundSandbox(sessionId: string) {
  const response = await fetch(`${getApiBaseUrl()}/playground/${sessionId}/release-sandbox`, { method: "POST" });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `API request failed with ${response.status}`);
  }
  return response.json() as Promise<{ released: boolean }>;
}

export async function stopPlaygroundAgentRun(sessionId: string, agentRunId: string) {
  const response = await fetch(
    `${getApiBaseUrl()}/playground/${sessionId}/runs/${agentRunId}/stop`,
    { method: "POST" },
  );
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `API request failed with ${response.status}`);
  }
  return response.json() as Promise<{ cancelling: boolean }>;
}

export class PlaygroundFollowUpError extends Error {
  constructor(public readonly kind: "sandbox_released" | "other", message: string) {
    super(message);
  }
}

export async function sendPlaygroundFollowUp(
  sessionId: string,
  agentRunId: string,
  text: string,
) {
  const response = await fetch(
    `${getApiBaseUrl()}/playground/${sessionId}/runs/${agentRunId}/follow-up`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    },
  );
  if (!response.ok) {
    const message = await response.text();
    if (response.status === 409) {
      throw new PlaygroundFollowUpError("sandbox_released", "sandbox_released");
    }
    throw new PlaygroundFollowUpError("other", message || `API request failed with ${response.status}`);
  }
  return response.json() as Promise<{ accepted: boolean; eventId: string }>;
}

export async function listSavedPlaygroundSessions() {
  const response = await fetch(`${getApiBaseUrl()}/playground/saved`, { cache: "no-store" });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `API request failed with ${response.status}`);
  }
  return response.json() as Promise<PlaygroundSessionResponse[]>;
}

export type PlaygroundScoreInput = {
  agentRunId: string;
  score: number;
  rationale?: string | undefined;
  correctness?: number | null | undefined;
  codeQuality?: number | null | undefined;
  ux?: number | null | undefined;
  shipIt?: number | null | undefined;
};

export async function getPlaygroundAutograders(sessionId: string) {
  const response = await fetch(
    `${getApiBaseUrl()}/playground/${sessionId}/autograders`,
    { cache: "no-store" },
  );
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `API request failed with ${response.status}`);
  }
  return response.json() as Promise<PlaygroundAutograderRunResponse[]>;
}

export async function scorePlayground(sessionId: string, scores: PlaygroundScoreInput[]) {
  const response = await fetch(`${getApiBaseUrl()}/playground/${sessionId}/score`, {
    body: JSON.stringify({ scores }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `API request failed with ${response.status}`);
  }

  return response.json() as Promise<{ accepted: boolean }>;
}

export async function autoGradePlayground(sessionId: string, graders?: string[]) {
  const response = await fetch(`${getApiBaseUrl()}/playground/${sessionId}/grade-auto`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(graders && graders.length > 0 ? { graders } : {}),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `API request failed with ${response.status}`);
  }

  return response.json() as Promise<{ accepted: boolean; autograderRunIds: string[] }>;
}

export async function listModels() {
  const response = await fetch(`${getApiBaseUrl()}/models`, { cache: "no-store" });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `API request failed with ${response.status}`);
  }

  const data = await response.json() as { count: number; retrievedAt: string; models: ModelInfo[] };
  return data.models;
}

export async function listDatasets() {
  const response = await fetch(`${getApiBaseUrl()}/datasets`, { cache: "no-store" });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `API request failed with ${response.status}`);
  }

  const data = await response.json() as { datasets: DatasetSummary[] };
  return data.datasets;
}

export async function getDataset(slug: string) {
  const response = await fetch(`${getApiBaseUrl()}/datasets/${encodeURIComponent(slug)}`, { cache: "no-store" });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `API request failed with ${response.status}`);
  }

  return response.json() as Promise<DatasetDetail>;
}

export async function createDataset(payload: { slug: string; name: string; description?: string; caseIds?: string[] }) {
  const response = await fetch(`${getApiBaseUrl()}/datasets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `API request failed with ${response.status}`);
  }

  return response.json() as Promise<{ dataset: DatasetSummary }>;
}

export async function deleteDataset(slug: string) {
  const response = await fetch(`${getApiBaseUrl()}/datasets/${encodeURIComponent(slug)}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `API request failed with ${response.status}`);
  }

  return response.json() as Promise<{ deleted: boolean }>;
}

export async function addCasesToDataset(slug: string, caseIds: string[]) {
  const response = await fetch(`${getApiBaseUrl()}/datasets/${encodeURIComponent(slug)}/cases`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ caseIds }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `API request failed with ${response.status}`);
  }

  return response.json() as Promise<{ added: number }>;
}

export async function removeCaseFromDataset(slug: string, caseId: string) {
  const response = await fetch(`${getApiBaseUrl()}/datasets/${encodeURIComponent(slug)}/cases/${encodeURIComponent(caseId)}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `API request failed with ${response.status}`);
  }

  return response.json() as Promise<{ removed: boolean }>;
}

// ─── Benchmark types ──────────────────────────────────────────────

export type BenchmarkAgentConfig = {
  modelId: string;
  mode: "plan-only" | "implementation-only" | "end-to-end";
};

export type CreateBenchmarkData = {
  name: string;
  datasetId: string;
  mode: "plan_only" | "implementation_only" | "end_to_end";
  agentConfigs: Array<{
    modelId: string;
    mode?: "plan_only" | "implementation_only" | "end_to_end";
    maxTurns?: number;
    maxWallClockSeconds?: number;
  }>;
};

export type BenchmarkExperiment = {
  id: string;
  name: string;
  datasetSlug: string;
  datasetName?: string;
  status: string;
  agent1ModelId: string;
  agent1Mode: string;
  agent2ModelId: string | null;
  agent2Mode: string | null;
  totalCases: number;
  totalRuns: number;
  completedRuns: number;
  failedRuns: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

export type BenchmarkRun = {
  id: string;
  benchmarkId: string;
  agent: "agent1" | "agent2";
  caseId: string;
  caseTitle?: string;
  mode: string;
  modelId: string;
  status: string;
  stage: string;
  eventCount: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

export type BenchmarkResults = {
  benchmarkId: string;
  name: string;
  datasetSlug: string;
  status: string;
  agent1: BenchmarkResultsAgent;
  agent2: BenchmarkResultsAgent;
  perCase: BenchmarkCaseResult[];
  winner: "agent1" | "agent2" | "tie" | null;
};

export type BenchmarkResultsAgent = {
  modelId: string;
  mode: string;
  planScore: number | null;
  implScore: number | null;
  testScore: number | null;
  graderVerdict: "winner" | "runner_up" | "tie" | null;
  totalScore: number | null;
  resolvedCases: number;
  totalCases: number;
};

export type BenchmarkCaseResult = {
  caseId: string;
  caseTitle: string;
  agent1Status: string;
  agent2Status: string;
  agent1PlanScore: number | null;
  agent2PlanScore: number | null;
  agent1ImplScore: number | null;
  agent2ImplScore: number | null;
  agent1TestPassed: boolean | null;
  agent2TestPassed: boolean | null;
  winner: "agent1" | "agent2" | "tie" | null;
};

export type GradingScores = {
  runId: string;
  planScore: number | null;
  implScore: number | null;
  testScore: number | null;
  graderVerdict: string | null;
  totalScore: number | null;
  gradedAt: string | null;
};

// ─── Benchmark API functions ──────────────────────────────────────

export async function getBenchmarks(): Promise<BenchmarkExperiment[]> {
  const response = await fetch(`${getApiBaseUrl()}/benchmarks`, { cache: "no-store" });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `API request failed with ${response.status}`);
  }

  return response.json() as Promise<BenchmarkExperiment[]>;
}

export async function getBenchmark(id: string): Promise<BenchmarkExperiment> {
  const response = await fetch(`${getApiBaseUrl()}/benchmarks/${encodeURIComponent(id)}`, { cache: "no-store" });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `API request failed with ${response.status}`);
  }

  return response.json() as Promise<BenchmarkExperiment>;
}

export async function createBenchmark(data: CreateBenchmarkData): Promise<BenchmarkExperiment> {
  const response = await fetch(`${getApiBaseUrl()}/benchmarks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `API request failed with ${response.status}`);
  }

  return response.json() as Promise<BenchmarkExperiment>;
}

export async function startBenchmark(id: string): Promise<{ status: string; runCount: number }> {
  const response = await fetch(`${getApiBaseUrl()}/benchmarks/${encodeURIComponent(id)}/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `API request failed with ${response.status}`);
  }

  return response.json() as Promise<{ status: string; runCount: number }>;
}

export async function getBenchmarkResults(id: string): Promise<BenchmarkResults> {
  const response = await fetch(`${getApiBaseUrl()}/benchmarks/${encodeURIComponent(id)}/results`, {
    cache: "no-store",
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `API request failed with ${response.status}`);
  }

  return response.json() as Promise<BenchmarkResults>;
}

export async function gradePlan(runId: string, judgeModelId?: string): Promise<{ jobId: string }> {
  const response = await fetch(`${getApiBaseUrl()}/grading/plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(judgeModelId ? { runId, judgeModelId } : { runId }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `API request failed with ${response.status}`);
  }

  return response.json() as Promise<{ jobId: string }>;
}

export async function gradeImplementation(runId: string, judgeModelId?: string): Promise<{ jobId: string }> {
  const response = await fetch(`${getApiBaseUrl()}/grading/implementation`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(judgeModelId ? { runId, judgeModelId } : { runId }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `API request failed with ${response.status}`);
  }

  return response.json() as Promise<{ jobId: string }>;
}

export async function gradeExternal(runAId: string, runBId: string, judgeModelId?: string): Promise<{ jobId: string }> {
  const response = await fetch(`${getApiBaseUrl()}/grading/external`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(judgeModelId ? { runAId, runBId, judgeModelId } : { runAId, runBId }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `API request failed with ${response.status}`);
  }

  return response.json() as Promise<{ jobId: string }>;
}

export async function getGradingScores(runId: string): Promise<GradingScores> {
  const response = await fetch(`${getApiBaseUrl()}/runs/${encodeURIComponent(runId)}/scores`, {
    cache: "no-store",
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `API request failed with ${response.status}`);
  }

  return response.json() as Promise<GradingScores>;
}

