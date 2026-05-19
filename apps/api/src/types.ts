export type ApiStatus = "ok";

export type ModelSyncMode = "dry-run" | "enqueue";

export type ModelSyncRequest = {
  provider?: string;
  modelIds?: string[];
  mode?: ModelSyncMode;
};

export type ModelSyncReply = {
  accepted: true;
  mode: ModelSyncMode;
  provider: "openrouter";
  requestedModelIds: string[];
  count: number;
  retrievedAt: string;
  models: Array<{
    id: string;
    name: string;
    contextWindow?: number;
    inputUsdPer1M?: number;
    outputUsdPer1M?: number;
    supportsToolCalling: boolean;
    supportsStructuredOutputs: boolean;
  }>;
  message: string;
};

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

export type RunEventKind =
  | "created"
  | "queued"
  | "started"
  | "log"
  | "artifact"
  | "completed"
  | "failed";

export type RunEventRequest = {
  type: RunEventKind;
  message?: string;
  payload?: Record<string, unknown>;
};

export type RunEvent = RunEventRequest & {
  id: string;
  runId: string;
  receivedAt: string;
};
