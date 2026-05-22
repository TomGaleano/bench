import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { readdir, readFile } from "node:fs/promises";
import {
  cloneRepoAtCommitInRuntime,
  createBenchmarkRuntime,
  runSandboxPiAgent,
  type RuntimeWorkspace,
} from "@pilab/runtime";

const execFileAsync = promisify(execFile);

export type PiRunMode = "plan" | "implement" | "end_to_end";

export type PiRunnerInput = {
  runId: string;
  mode: PiRunMode;
  workspacePath: string;
  modelId: string;
  prompt: string;
  maxTurns: number;
  maxWallClockSeconds: number;
  runtimeWorkspace?: RuntimeWorkspace;
};

export type PiRunnerEvent = {
  stage: "prepare" | "plan" | "implement" | "evaluate";
  kind:
    | "status"
    | "assistant_text_delta"
    | "tool_call_started"
    | "tool_call_delta"
    | "tool_call_finished"
    | "file_changed"
    | "patch_created"
    | "test_started"
    | "test_finished"
    | "cost_update"
    | "artifact_created"
    | "error";
  payload: unknown;
};

export type PiRunnerResult = {
  runId: string;
  status: "completed" | "failed" | "timeout" | "cancelled";
  planMarkdown?: string;
  rawSession?: unknown[];
  errorMessage?: string;
};

export type PiRunner = {
  run(input: PiRunnerInput, emit: (event: PiRunnerEvent) => void): Promise<PiRunnerResult>;
  abort(runId: string): Promise<void>;
};

export type PiSdkEventMapping = {
  event: PiRunnerEvent;
  textDelta?: string;
};

export function normalizePiSdkEvent(event: unknown): PiSdkEventMapping | null {
  if (!isRecord(event)) {
    return null;
  }

  const type = stringValue(event.type);

  if (type === "message_update" && isRecord(event.assistantMessageEvent)) {
    const assistantEvent = event.assistantMessageEvent;
    const assistantType = stringValue(assistantEvent.type);

    if (assistantType === "text_delta") {
      const delta = stringValue(assistantEvent.delta) ?? "";
      return {
        event: {
          stage: "plan",
          kind: "assistant_text_delta",
          payload: { delta },
        },
        textDelta: delta,
      };
    }

    if (assistantType === "toolcall_start") {
      return {
        event: {
          stage: "plan",
          kind: "tool_call_started",
          payload: scrubUndefined({
            toolName: stringValue(assistantEvent.toolName) ?? stringValue(assistantEvent.name) ?? "unknown",
            toolCallId: stringValue(assistantEvent.toolCallId) ?? stringValue(assistantEvent.id),
          }),
        },
      };
    }

    if (assistantType === "toolcall_delta") {
      return {
        event: {
          stage: "plan",
          kind: "tool_call_delta",
          payload: { delta: assistantEvent },
        },
      };
    }

    if (assistantType === "toolcall_end") {
      return {
        event: {
          stage: "plan",
          kind: "tool_call_finished",
          payload: scrubUndefined({
            toolName: stringValue(assistantEvent.toolName) ?? stringValue(assistantEvent.name) ?? "unknown",
            toolCallId: stringValue(assistantEvent.toolCallId) ?? stringValue(assistantEvent.id),
          }),
        },
      };
    }

    return null;
  }

  if (type === "tool_execution_start") {
    return {
      event: {
        stage: "plan",
        kind: "tool_call_started",
        payload: {
          toolName: stringValue(event.toolName) ?? "unknown",
          toolCallId: stringValue(event.toolCallId),
        },
      },
    };
  }

  if (type === "tool_execution_update") {
    return {
      event: {
        stage: "plan",
        kind: "tool_call_delta",
        payload: scrubUndefined({
          toolName: stringValue(event.toolName),
          toolCallId: stringValue(event.toolCallId),
          update: event,
        }),
      },
    };
  }

  if (type === "tool_execution_end") {
    return {
      event: {
        stage: "plan",
        kind: "tool_call_finished",
        payload: scrubUndefined({
          toolName: stringValue(event.toolName) ?? "unknown",
          toolCallId: stringValue(event.toolCallId),
          isError: Boolean(event.isError),
        }),
      },
    };
  }

  if (type && statusEventTypes.has(type)) {
    return {
      event: {
        stage: "plan",
        kind: "status",
        payload: { status: type },
      },
    };
  }

  return null;
}

const statusEventTypes = new Set([
  "agent_start",
  "agent_end",
  "turn_start",
  "turn_end",
  "message_start",
  "message_end",
  "queue_update",
  "compaction_start",
  "compaction_end",
  "auto_retry_start",
  "auto_retry_end",
]);

export class PiSdkPlanRunner implements PiRunner {
  private readonly abortControllers = new Map<string, AbortController>();

  async run(input: PiRunnerInput, emit: (event: PiRunnerEvent) => void): Promise<PiRunnerResult> {
    if (input.mode !== "plan") {
      return {
        runId: input.runId,
        status: "failed",
        errorMessage: "Only plan mode is implemented for the Pi runner slice.",
      };
    }

    if (process.env.PI_RUNNER_FAKE === "1") {
      return runFakePlan(input, emit);
    }

    const controller = new AbortController();
    this.abortControllers.set(input.runId, controller);
    const rawSession: unknown[] = [];
    const planChunks: string[] = [];
    let heartbeatInterval: ReturnType<typeof setInterval> | undefined;
    let runtimeWorkspace = input.runtimeWorkspace;
    let ownsRuntimeWorkspace = false;

    try {
      emit({
        stage: "prepare",
        kind: "status",
        payload: { status: "loading_pi_sdk" },
      });

      const provider = process.env.PI_PROVIDER ?? "openrouter";
      const modelName = input.modelId.includes("/")
        ? input.modelId.slice(input.modelId.indexOf("/") + 1)
        : input.modelId;
      const runtimeKey = process.env.OPENROUTER_API_KEY;

      if (!runtimeKey) {
        throw new Error("OPENROUTER_API_KEY is required for PI plan runner");
      }

      if (!runtimeWorkspace) {
        runtimeWorkspace = await cloneRepoAtCommitInRuntime({
          runtime: createBenchmarkRuntime(),
          workspaceId: `pi-plan-${input.runId}`,
          repoUrl: input.workspacePath,
          commitSha: "HEAD",
          timeoutMs: input.maxWallClockSeconds * 1000,
          env: { CI: "true" },
        });
        ownsRuntimeWorkspace = true;
      }

      let eventCount = 0;
      let lastEventTime = Date.now();
      heartbeatInterval = setInterval(() => {
        const elapsed = (Date.now() - lastEventTime) / 1000;
        if (elapsed > 30) {
          console.warn(`[PiSdkPlanRunner] HEARTBEAT: no events for ${elapsed.toFixed(1)}s (total events: ${eventCount})`);
        }
      }, 5000);

      const handleSdkEvent = (sdkEvent: unknown) => {
        eventCount += 1;
        lastEventTime = Date.now();
        if (eventCount % 50 === 1 || eventCount <= 5) {
          console.log(`[PiSdkPlanRunner] event #${eventCount} type=${stringValue((sdkEvent as Record<string, unknown>)?.type) ?? "unknown"}`);
        }
        rawSession.push(sdkEvent);
        const mapped = normalizePiSdkEvent(sdkEvent);
        if (!mapped) {
          return;
        }
        if (mapped.textDelta) {
          planChunks.push(mapped.textDelta);
        }
        emit(mapped.event);
      };

      console.log(`[PiSdkPlanRunner] starting sandbox PI agent stream...`);

      emit({
        stage: "plan",
        kind: "status",
        payload: { status: "prompt_started" },
      });

      try {
        await runSandboxPiAgent({
          workspace: runtimeWorkspace,
          runId: input.runId,
          provider,
          modelName,
          prompt: input.prompt,
          systemPrompt: `You are running in Pi Lab plan-only benchmark mode inside an isolated Daytona sandbox at ${runtimeWorkspace.rootPath}. You are inside the task repository. Explore the repository structure, read relevant files, and produce a concrete implementation plan based on what you find. Do not modify files.`,
          apiKey: runtimeKey,
          tools: ["read", "grep", "find", "ls"],
          timeoutMs: input.maxWallClockSeconds * 1000,
          signal: controller.signal,
          onEvent: handleSdkEvent,
        });
      } catch (timeoutError) {
        console.warn(`[PiSdkPlanRunner] timeout/cancel reached, aborting session...`);
        throw timeoutError;
      }

      clearInterval(heartbeatInterval);
      console.log(`[PiSdkPlanRunner] prompt finished, total events: ${eventCount}`);

      const mutation = await detectRuntimeWorkspaceMutation(runtimeWorkspace);
      if (mutation) {
        emit({
          stage: "plan",
          kind: "error",
          payload: { message: "Plan-only run modified the workspace", details: mutation },
        });
        return {
          runId: input.runId,
          status: "failed",
          planMarkdown: planChunks.join(""),
          rawSession,
          errorMessage: "Plan-only run modified the workspace.",
        };
      }

      return {
        runId: input.runId,
        status: "completed",
        planMarkdown: planChunks.join(""),
        rawSession,
      };
    } catch (error) {
      clearInterval(heartbeatInterval);
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[PiSdkPlanRunner] caught error: ${message}`);
      emit({
        stage: "plan",
        kind: "error",
        payload: { message },
      });
      return {
        runId: input.runId,
        status: message === "Pi runner timed out" ? "timeout" : "failed",
        planMarkdown: planChunks.join(""),
        rawSession,
        errorMessage: message,
      };
    } finally {
      if (ownsRuntimeWorkspace) {
        await runtimeWorkspace?.delete().catch(() => undefined);
      }
      this.abortControllers.delete(input.runId);
    }
  }

  async abort(runId: string): Promise<void> {
    this.abortControllers.get(runId)?.abort();
  }
}

async function runFakePlan(
  input: PiRunnerInput,
  emit: (event: PiRunnerEvent) => void,
): Promise<PiRunnerResult> {
  emit({ stage: "prepare", kind: "status", payload: { status: "fake_prepare" } });
  emit({ stage: "plan", kind: "status", payload: { status: "fake_agent_start" } });
  const planMarkdown = [
    `# Plan for ${input.runId}`,
    "",
    "1. Inspect the case version and repository context.",
    "2. Identify the smallest implementation path.",
    "3. Add tests before changing behavior.",
    "4. Verify the resulting diff and summarize risks.",
  ].join("\n");

  for (const delta of planMarkdown.match(/.{1,80}/gs) ?? [planMarkdown]) {
    emit({ stage: "plan", kind: "assistant_text_delta", payload: { delta } });
  }

  const mutation = await detectWorkspaceMutation(
    input.workspacePath,
    await createWorkspaceManifest(input.workspacePath),
  );
  if (mutation) {
    emit({
      stage: "plan",
      kind: "error",
      payload: { message: "Plan-only run modified the workspace", details: mutation },
    });
    return {
      runId: input.runId,
      status: "failed",
      planMarkdown,
      rawSession: [{ type: "fake_agent_end" }],
      errorMessage: "Plan-only run modified the workspace.",
    };
  }

  emit({ stage: "plan", kind: "status", payload: { status: "fake_agent_end" } });
  return {
    runId: input.runId,
    status: "completed",
    planMarkdown,
    rawSession: [{ type: "fake_agent_end", planMarkdown }],
  };
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Pi runner timed out")), timeoutMs);
    const abort = () => reject(new Error("Pi runner cancelled"));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
    });
  });
}

async function getGitDiff(workspacePath: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", workspacePath, "diff", "--"], {
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout;
  } catch {
    return "";
  }
}

async function detectWorkspaceMutation(
  workspacePath: string,
  beforeManifest: Map<string, string>,
): Promise<Record<string, unknown> | null> {
  const repoStates = await Promise.all(
    (await findGitRepos(workspacePath)).map(async (repoPath) => ({
      repoPath,
      diff: await getGitCommandOutput(repoPath, ["diff", "--"]),
      stagedDiff: await getGitCommandOutput(repoPath, ["diff", "--cached", "--"]),
      status: await getGitCommandOutput(repoPath, [
        "status",
        "--porcelain=v1",
        "--untracked-files=all",
      ]),
    })),
  );
  const dirtyRepos = repoStates.filter(
    (repo) => repo.diff.trim() || repo.stagedDiff.trim() || repo.status.trim(),
  );
  const afterManifest = await createWorkspaceManifest(workspacePath);
  const manifestChanges = diffManifests(beforeManifest, afterManifest);

  if (dirtyRepos.length === 0 && manifestChanges.length === 0) {
    return null;
  }

  return {
    dirtyRepos,
    manifestChanges,
  };
}

async function detectRuntimeWorkspaceMutation(workspace: RuntimeWorkspace): Promise<Record<string, unknown> | null> {
  const result = await workspace.run({
    command: "git diff -- . ':(exclude).pilab-agent-runtime' ':(exclude).pilab-agent' && git diff --cached -- . ':(exclude).pilab-agent-runtime' ':(exclude).pilab-agent' && git status --porcelain=v1 --untracked-files=all -- . ':(exclude).pilab-agent-runtime' ':(exclude).pilab-agent'",
    cwd: workspace.rootPath,
    timeoutMs: 60_000,
  });
  const output = `${result.stdout}${result.stderr}`.trim();
  return output ? { status: output } : null;
}

async function getGitCommandOutput(repoPath: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", repoPath, ...args], {
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout;
  } catch (error) {
    if (isExecErrorWithStdout(error)) {
      return `${error.stdout ?? ""}${error.stderr ?? ""}`;
    }
    return "";
  }
}

async function findGitRepos(workspacePath: string): Promise<string[]> {
  const repos: string[] = [];

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    if (entries.some((entry) => entry.isDirectory() && entry.name === ".git")) {
      repos.push(dir);
      return;
    }

    await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && !ignoredManifestDir(entry.name))
        .map((entry) => walk(join(dir, entry.name))),
    );
  }

  await walk(workspacePath);
  return repos;
}

async function createWorkspaceManifest(workspacePath: string): Promise<Map<string, string>> {
  const manifest = new Map<string, string>();

  async function walk(dir: string, relativeDir = ""): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.isDirectory() && ignoredManifestDir(entry.name)) {
        continue;
      }

      const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        await walk(fullPath, relativePath);
      } else if (entry.isFile()) {
        const digest = createHash("sha256").update(await readFile(fullPath)).digest("hex");
        manifest.set(relativePath, digest);
      }
    }
  }

  await walk(workspacePath);
  return manifest;
}

function ignoredManifestDir(name: string): boolean {
  return name === ".git" || name === "node_modules" || name === ".next";
}

function diffManifests(before: Map<string, string>, after: Map<string, string>): string[] {
  const changes: string[] = [];
  const paths = new Set([...before.keys(), ...after.keys()]);

  for (const path of [...paths].sort()) {
    if (!before.has(path)) {
      changes.push(`added:${path}`);
    } else if (!after.has(path)) {
      changes.push(`removed:${path}`);
    } else if (before.get(path) !== after.get(path)) {
      changes.push(`changed:${path}`);
    }
  }

  return changes;
}

function isExecErrorWithStdout(
  error: unknown,
): error is { stdout?: string; stderr?: string } {
  return typeof error === "object" && error !== null;
}

function agentDir(runId: string): string {
  return join(process.cwd(), "output", "pi-runner", runId);
}

function agentAuthPath(runId: string): string {
  return join(agentDir(runId), "auth.json");
}

export async function ensurePiRunnerOutputDir(runId: string): Promise<void> {
  await mkdir(agentDir(runId), { recursive: true });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function scrubUndefined(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  );
}
