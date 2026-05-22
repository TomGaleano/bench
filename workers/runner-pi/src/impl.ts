import { execFile } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { promisify } from "node:util";

import {
  createPiRunnerProgress,
  type PiRunnerImplJobData,
  type PiRunnerImplJobResult,
} from "@pilab/jobs";
import type { Job } from "bullmq";
import {
  cloneRepoAtCommitInRuntime,
  createBenchmarkRuntime,
  runSandboxPiAgent,
  shellQuote,
  type RuntimeWorkspace,
} from "@pilab/runtime";

import {
  createPiRunnerObjectStore,
  type PiRunnerObjectStore,
} from "./object-store.js";
import {
  ensurePiRunnerOutputDir,
  type PiRunner,
  type PiRunnerEvent,
  type PiRunnerInput,
  type PiRunnerResult,
} from "./index.js";

const execFileAsync = promisify(execFile);

// ── Types ──────────────────────────────────────────────────────────────────

type JsonRecord = Record<string, unknown>;
type StoredArtifact = Awaited<
  ReturnType<ReturnType<typeof createPiRunnerObjectStore>["putArtifact"]>
>;

export type PiRunnerImplStore = {
  markRunPreparing(runId: string): Promise<void>;
  markRunRunning(runId: string): Promise<void>;
  appendEvent(runId: string, event: PiRunnerEvent): Promise<number>;
  loadPlan(planRunId: string): Promise<{ planMarkdown: string }>;
  loadCaseVersion(caseVersionId: string): Promise<{
    repoOwner: string;
    repoName: string;
    baseCommitSha: string;
    testCommands: string[];
  }>;
  loadIssueContent(caseVersionId: string): Promise<{ issueTitle: string; issueBody: string }>;
  persistImplResult(input: PersistImplResultInput): Promise<PersistedImplResult>;
  markRunFinished(input: MarkRunFinishedInput): Promise<void>;
};

type PersistImplResultInput = {
  runId: string;
  caseVersionId: string;
  patchDiff: string;
  rawSession: unknown[];
  testResults: TestResult[];
};

type PersistedImplResult = {
  patchArtifactId: string;
  patchArtifactKey: string;
  rawSessionArtifactId: string;
  rawSessionArtifactKey: string;
  evaluationId: string;
  resolved: boolean;
};

type MarkRunFinishedInput = {
  runId: string;
  status: "completed" | "failed" | "timeout" | "cancelled";
  errorMessage?: string;
};

type TestResult = {
  testName: string;
  passed: boolean;
  output?: string;
};

export type ImplRunnerInput = PiRunnerInput & {
  planMarkdown: string;
  baseCommitSha: string;
  repoOwner: string;
  repoName: string;
  testCommands: string[];
  issueTitle: string;
  issueBody: string;
};

export type ImplRunnerResult = PiRunnerResult & {
  patchDiff?: string;
  testResults?: TestResult[];
};

// ── Bash safety ────────────────────────────────────────────────────────────

const ALLOWED_COMMANDS = new Set([
  "git",
  "npm",
  "npx",
  "pnpm",
  "yarn",
  "node",
  "python",
  "python3",
  "pip",
  "pip3",
  "cargo",
  "go",
  "rustc",
  "make",
  "cmake",
  "./configure",
  "meson",
  "ninja",
  "ls",
  "cat",
  "head",
  "tail",
  "grep",
  "find",
  "mkdir",
  "cp",
  "mv",
  "rm",
  "curl",
  "wget",
  "echo",
  "test",
  "touch",
  "chmod",
  "chown",
  "diff",
  "patch",
  "sed",
  "awk",
  "sort",
  "uniq",
  "wc",
  "which",
  "type",
  "command",
  "printf",
  "tee",
  "xargs",
  "dirname",
  "basename",
  "realpath",
  "readlink",
  "ln",
  "tar",
  "gzip",
  "gunzip",
  "unzip",
  "zip",
  "sh",
  "bash",
  "env",
  "export",
  "source",
  "jq",
  "tsc",
  "tsx",
  "eslint",
  "prettier",
  "jest",
  "vitest",
  "mocha",
  "pytest",
  "poetry",
  "docker",
  "docker-compose",
  "dpkg",
  "apt-get",
  "brew",
]);

const DANGEROUS_PATTERNS = [
  /[;&|`$]\s*rm\s+-rf\s+\//,
  />\s*\/dev\/(sd|hd|nvme|dm-)/,
  /dd\s+if=/,
  /mkfs\./,
  />\s*\/etc\//,
  /curl.*\|\s*(ba)?sh/,
  /:\s*(){ :\|:& };:/,
];

function validateBashCommand(command: string, workspacePath: string): string | null {
  const trimmed = command.trim();
  if (!trimmed) {
    return "empty command";
  }

  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(trimmed)) {
      return `command matches dangerous pattern: ${pattern}`;
    }
  }

  if (/\bsudo\b/.test(trimmed)) {
    return "sudo is not allowed";
  }

  const firstWord = trimmed.split(/\s+/)[0] ?? "";
  const cmdName = firstWord.includes("/") ? firstWord.split("/").pop() ?? firstWord : firstWord;
  const cmdBase = cmdName.split(".")[0] ?? cmdName;

  if (!ALLOWED_COMMANDS.has(cmdName) && !ALLOWED_COMMANDS.has(cmdBase) && !ALLOWED_COMMANDS.has(firstWord)) {
    return `command "${cmdName}" is not in the allowlist`;
  }

  return null;
}

function isPathWithinWorkspace(filePath: string, workspacePath: string): boolean {
  const resolvedPath = resolve(filePath);
  const resolvedWorkspace = resolve(workspacePath);
  return resolvedPath.startsWith(resolvedWorkspace + sep) || resolvedPath === resolvedWorkspace;
}

// ── Workspace management ───────────────────────────────────────────────────

async function cloneRepoAtCommit(input: {
  repoOwner: string;
  repoName: string;
  baseCommitSha: string;
  workspacePath: string;
}): Promise<void> {
  const repoUrl = `https://github.com/${input.repoOwner}/${input.repoName}.git`;

  await rm(input.workspacePath, { recursive: true, force: true });
  await mkdir(input.workspacePath, { recursive: true });

  console.log(`[cloneRepoAtCommit] Cloning ${repoUrl}@${input.baseCommitSha} into ${input.workspacePath}`);

  // Robust shallow fetch: init empty repo, add remote, fetch exactly the
  // commit we need, then checkout. This works for any reachable commit,
  // including old ones not on the default branch.
  await execFileAsync("git", ["init", input.workspacePath]);
  await execFileAsync("git", [
    "-C",
    input.workspacePath,
    "remote",
    "add",
    "origin",
    repoUrl,
  ]);

  try {
    await execFileAsync("git", [
      "-C",
      input.workspacePath,
      "fetch",
      "--depth=1",
      "origin",
      input.baseCommitSha,
    ]);
  } catch (fetchError) {
    // Fallback: some hosts don't allow fetching arbitrary SHAs directly.
    // Try fetching the SHA as a ref, or fetch a bit more history.
    console.warn(`[cloneRepoAtCommit] shallow fetch failed for ${input.baseCommitSha}, trying with --unshallow...`);
    await execFileAsync("git", [
      "-C",
      input.workspacePath,
      "fetch",
      "--unshallow",
      "origin",
    ]);
  }

  await execFileAsync("git", [
    "-C",
    input.workspacePath,
    "checkout",
    input.baseCommitSha,
  ]);

  console.log(`[cloneRepoAtCommit] Checked out ${input.baseCommitSha} successfully`);
}

async function createWorkspaceDir(runId: string): Promise<string> {
  const workspacePath = join(
    process.cwd(),
    "output",
    "pi-runner",
    runId,
    "workspace",
  );
  await mkdir(workspacePath, { recursive: true });
  return workspacePath;
}

async function runTestCommands(
  testCommands: string[],
  workspacePath: string,
): Promise<TestResult[]> {
  const results: TestResult[] = [];

  for (const cmd of testCommands) {
    const testName = cmd.replace(/\s+/g, "_").slice(0, 80);
    try {
      const { stdout, stderr } = await execFileAsync("bash", ["-c", cmd], {
        cwd: workspacePath,
        timeout: 300_000,
        maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env, CI: "true" },
      });
      results.push({
        testName,
        passed: true,
        output: stdout + stderr,
      });
    } catch (error) {
      const output = isExecErrorWithStdout(error)
        ? `${error.stdout ?? ""}${error.stderr ?? ""}`
        : String(error);
      results.push({
        testName,
        passed: false,
        output,
      });
    }
  }

  return results;
}

async function runTestCommandsInRuntime(
  testCommands: string[],
  workspace: RuntimeWorkspace,
): Promise<TestResult[]> {
  const results: TestResult[] = [];

  for (const cmd of testCommands) {
    const testName = cmd.replace(/\s+/g, "_").slice(0, 80);
    const result = await workspace.run({
      command: cmd,
      cwd: workspace.rootPath,
      timeoutMs: 300_000,
      env: { CI: "true" },
    });
    results.push({
      testName,
      passed: result.exitCode === 0,
      output: `${result.stdout}${result.stderr}`,
    });
  }

  return results;
}

async function applyPatchAndRunTestsInRuntime(input: {
  workspace: RuntimeWorkspace;
  patchDiff: string;
  testCommands: string[];
}): Promise<TestResult[]> {
  if (!input.patchDiff.trim()) {
    return [{ testName: "patch", passed: false, output: "Agent produced an empty patch." }];
  }

  await input.workspace.writeFile({
    path: ".pilab-agent.patch",
    content: input.patchDiff,
  });
  const applyResult = await input.workspace.run({
    command: `git apply ${shellQuote(`${input.workspace.rootPath}/.pilab-agent.patch`)}`,
    cwd: input.workspace.rootPath,
    timeoutMs: 60_000,
  });
  if (applyResult.exitCode !== 0) {
    return [{
      testName: "patch_apply",
      passed: false,
      output: `${applyResult.stdout}${applyResult.stderr}`,
    }];
  }

  return runTestCommandsInRuntime(input.testCommands, input.workspace);
}

async function runPiAgentInRuntime(input: {
  workspace: RuntimeWorkspace;
  runId: string;
  provider: string;
  modelName: string;
  prompt: string;
  systemPrompt: string;
  apiKey: string;
  timeoutMs: number;
  signal: AbortSignal;
  onEvent(event: unknown): void;
}): Promise<void> {
  const runtimeDir = ".pilab-agent-runtime";
  await input.workspace.writeFile({
    path: `${runtimeDir}/package.json`,
    content: JSON.stringify({
      type: "module",
      dependencies: { "@mariozechner/pi-coding-agent": "^0.73.0" },
    }, null, 2),
  });
  await input.workspace.writeFile({
    path: `${runtimeDir}/config.json`,
    content: JSON.stringify({
      runId: input.runId,
      provider: input.provider,
      modelName: input.modelName,
      prompt: input.prompt,
      systemPrompt: input.systemPrompt,
      workspacePath: input.workspace.rootPath,
    }),
  });
  await input.workspace.writeFile({
    path: `${runtimeDir}/run-pi-agent.mjs`,
    content: buildRuntimePiAgentScript(),
  });

  const install = await input.workspace.run({
    command: `npm install --prefix ${shellQuote(`${input.workspace.rootPath}/${runtimeDir}`)} --no-audit --no-fund --silent`,
    cwd: input.workspace.rootPath,
    timeoutMs: 180_000,
    env: { CI: "true" },
  });
  if (install.exitCode !== 0) {
    throw new Error(`Failed to install PI agent runtime in Daytona: ${install.stderr || install.stdout}`);
  }

  await withTimeout(
    new Promise<void>((resolve, reject) => {
      const parseStdout = createPiAgentLineParser(input.onEvent, reject);
      input.workspace.runStreaming({
        command: `node ${shellQuote(`${input.workspace.rootPath}/${runtimeDir}/run-pi-agent.mjs`)}`,
        cwd: input.workspace.rootPath,
        timeoutMs: input.timeoutMs,
        env: {
          CI: "true",
          OPENROUTER_API_KEY: input.apiKey,
        },
        onStdout: parseStdout,
      }).then((result) => {
        parseStdout("\n");
        if (result.exitCode !== 0) {
          reject(new Error(`Sandbox PI agent failed: ${result.stderr || result.stdout || `exit ${result.exitCode}`}`));
          return;
        }
        resolve();
      }, reject);
    }),
    input.timeoutMs,
    input.signal,
  );
}

function createPiAgentLineParser(onEvent: (event: unknown) => void, reject: (error: Error) => void): (chunk: string) => void {
  let buffer = "";
  return (chunk: string) => {
    buffer += chunk;
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = buffer.slice(0, newlineIndex).trimEnd();
      buffer = buffer.slice(newlineIndex + 1);
      if (line.startsWith("PILAB_EVENT ")) {
        try {
          const payload = JSON.parse(line.slice("PILAB_EVENT ".length)) as { event?: unknown };
          onEvent(payload.event);
        } catch (error) {
          reject(new Error(`Failed to parse sandbox PI event: ${error instanceof Error ? error.message : String(error)}`));
        }
      }
      newlineIndex = buffer.indexOf("\n");
    }
  };
}

function buildRuntimePiAgentScript(): string {
  return `import { readFileSync } from "node:fs";
import path from "node:path";
import * as pi from "@mariozechner/pi-coding-agent";

const config = JSON.parse(readFileSync(new URL("./config.json", import.meta.url), "utf8"));

function emit(event) {
  process.stdout.write("PILAB_EVENT " + JSON.stringify({ event }) + "\\n");
}

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) {
  throw new Error("OPENROUTER_API_KEY is required");
}

const agentDir = path.join(config.workspacePath, ".pilab-agent");
const authStorage = pi.AuthStorage.create(path.join(agentDir, "auth.json"));
authStorage.setRuntimeApiKey(config.provider, apiKey);

const modelRegistry = pi.ModelRegistry.create(authStorage);
const modelNames = config.modelName.includes("/")
  ? [config.modelName.slice(config.modelName.indexOf("/") + 1), config.modelName]
  : [config.modelName];
const model = modelNames.map((name) => modelRegistry.find(config.provider, name)).find(Boolean);
if (!model) {
  throw new Error(\`Pi model not found for provider \${config.provider}: \${config.modelName}\`);
}

const settingsManager = pi.SettingsManager.inMemory({
  compaction: { enabled: false },
  retry: { enabled: true, maxRetries: 1 },
});
const resourceLoader = new pi.DefaultResourceLoader({
  cwd: config.workspacePath,
  agentDir,
  settingsManager,
  systemPromptOverride: () => config.systemPrompt,
});
await resourceLoader.reload();

const { session } = await pi.createAgentSession({
  cwd: config.workspacePath,
  agentDir,
  model,
  thinkingLevel: "off",
  authStorage,
  modelRegistry,
  tools: ["read", "grep", "find", "ls", "write", "edit"],
  resourceLoader,
  sessionManager: pi.SessionManager.inMemory(config.workspacePath),
  settingsManager,
});

const unsubscribe = session.subscribe((event) => emit(event));
try {
  await session.prompt(config.prompt);
} finally {
  unsubscribe();
  session.dispose();
}
`;
}

async function getRuntimeWorkspacePatch(workspace: RuntimeWorkspace): Promise<string> {
  const result = await workspace.run({
    command: "git diff --",
    cwd: workspace.rootPath,
    timeoutMs: 60_000,
  });
  return result.exitCode === 0 ? result.stdout : "";
}

function isExecErrorWithStdout(
  error: unknown,
): error is { stdout?: string; stderr?: string } {
  return typeof error === "object" && error !== null;
}

// ── Fake implementation runner ──────────────────────────────────────────────

async function runFakeImpl(
  input: ImplRunnerInput,
  emit: (event: PiRunnerEvent) => void,
): Promise<ImplRunnerResult> {
  emit({ stage: "prepare", kind: "status", payload: { status: "fake_prepare" } });
  emit({ stage: "implement", kind: "status", payload: { status: "fake_agent_start" } });

  const planLines = input.planMarkdown
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const patchDiff = [
    "diff --git a/src/example.ts b/src/example.ts",
    "--- a/src/example.ts",
    "+++ b/src/example.ts",
    "@@ -1,3 +1,5 @@",
    " // Example file generated by fake impl runner",
    "+// Implementation added for run " + input.runId,
    "+// Based on plan: " + (planLines[0] ?? "no plan"),
    " export function example() {",
    "   return 'hello';",
    " }",
  ].join("\n");

  for (const delta of (patchDiff.match(/.{1,80}/gs) ?? [patchDiff])) {
    emit({ stage: "implement", kind: "assistant_text_delta", payload: { delta } });
  }

  emit({ stage: "implement", kind: "status", payload: { status: "fake_agent_end" } });
  emit({
    stage: "implement",
    kind: "patch_created",
    payload: { byteSize: patchDiff.length },
  });

  const testResults: TestResult[] = [
    { testName: "fake_test_1", passed: true },
    { testName: "fake_test_2", passed: true },
  ];

  return {
    runId: input.runId,
    status: "completed",
    rawSession: [{ type: "fake_agent_end" }],
    patchDiff,
    testResults,
  };
}

// ── Pi SDK implementation runner ────────────────────────────────────────────

export class PiSdkImplRunner implements PiRunner {
  private readonly abortControllers = new Map<string, AbortController>();

  async run(
    input: PiRunnerInput,
    emit: (event: PiRunnerEvent) => void,
  ): Promise<PiRunnerResult> {
    if (input.mode !== "implement") {
      return {
        runId: input.runId,
        status: "failed",
        errorMessage: "PiSdkImplRunner only supports implementation mode.",
      };
    }

    // The processor calls the impl runner differently — through the ImplRunner
    // interface. This base PiRunner implementation is a fallback that should
    // not be hit if the processor uses the dedicated impl runner path.
    return {
      runId: input.runId,
      status: "failed",
      errorMessage:
        "Use runImpl() instead of run() for implementation mode.",
    };
  }

  async runImpl(
    input: ImplRunnerInput,
    emit: (event: PiRunnerEvent) => void,
  ): Promise<ImplRunnerResult> {
    if (process.env.PI_RUNNER_FAKE === "1") {
      return runFakeImpl(input, emit);
    }

    const controller = new AbortController();
    this.abortControllers.set(input.runId, controller);
    const rawSession: unknown[] = [];
    const textChunks: string[] = [];
    let heartbeatInterval: ReturnType<typeof setInterval> | undefined;
    let runtimeWorkspace: RuntimeWorkspace | undefined;

    try {
      // Clone the repo at the base commit inside the Daytona sandbox. The PI
      // SDK agent and all shell commands run against this same workspace.
      emit({
        stage: "prepare",
        kind: "status",
        payload: { status: "cloning_repo" },
      });

      runtimeWorkspace = await cloneRepoAtCommitInRuntime({
        runtime: createBenchmarkRuntime(),
        workspaceId: `pi-impl-${input.runId}`,
        repoUrl: `https://github.com/${input.repoOwner}/${input.repoName}.git`,
        commitSha: input.baseCommitSha,
        timeoutMs: 300_000,
        env: { CI: "true" },
      });

      emit({
        stage: "prepare",
        kind: "status",
        payload: { status: "loading_pi_sdk" },
      });

      const pi = await import("@mariozechner/pi-coding-agent");
      const provider = process.env.PI_PROVIDER ?? "openrouter";
      const modelName = input.modelId.includes("/")
        ? input.modelId.slice(input.modelId.indexOf("/") + 1)
        : input.modelId;
      const runtimeKey = process.env.OPENROUTER_API_KEY;

      if (!runtimeKey) {
        throw new Error("OPENROUTER_API_KEY is required for PI implementation runner");
      }

      const authStorage = pi.AuthStorage.create(
        join(process.cwd(), "output", "pi-runner", input.runId, "auth.json"),
      );
      authStorage.setRuntimeApiKey(provider, runtimeKey);

      const modelRegistry = pi.ModelRegistry.create(authStorage);
      const model = modelRegistry.find(provider, modelName);

      console.log(`[PiSdkImplRunner] modelRegistry.find("${provider}", "${modelName}") => ${model ? "FOUND" : "NOT FOUND"}`);
      if (model) {
        console.log(`[PiSdkImplRunner] resolved model: ${JSON.stringify({ id: model.id, name: model.name, contextWindow: model.contextWindow, maxTokens: model.maxTokens })}`);
      }

      if (!model) {
        throw new Error(
          `Pi model not found for provider ${provider}: ${modelName}`,
        );
      }

      const planContext = input.planMarkdown
        ? `\n\n## Implementation Plan\n\nThe following plan was generated during the planning phase. Follow it to implement the changes:\n\n${input.planMarkdown}`
        : "";

      const issueContext =
        input.issueTitle
          ? `\n\n## GitHub Issue: ${input.issueTitle}\n\n${input.issueBody || ""}`
          : "";

      let eventCount = 0;
      let lastEventTime = Date.now();
      heartbeatInterval = setInterval(() => {
        const elapsed = (Date.now() - lastEventTime) / 1000;
        if (elapsed > 30) {
          console.warn(`[PiSdkImplRunner] HEARTBEAT: no events for ${elapsed.toFixed(1)}s (total events: ${eventCount})`);
        }
      }, 5000);

      const handleSdkEvent = (sdkEvent: unknown) => {
        eventCount += 1;
        lastEventTime = Date.now();
        if (eventCount % 50 === 1 || eventCount <= 5) {
          console.log(`[PiSdkImplRunner] event #${eventCount} type=${stringValue((sdkEvent as Record<string, unknown>)?.type) ?? "unknown"}`);
        }
        rawSession.push(sdkEvent);
        const mapped = normalizePiSdkEventForImpl(sdkEvent);
        if (!mapped) {
          return;
        }
        if (mapped.textDelta) {
          textChunks.push(mapped.textDelta);
        }
        emit(mapped.event);
      };

      console.log(`[PiSdkImplRunner] starting sandbox PI agent stream...`);

      emit({
        stage: "implement",
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
          systemPrompt: `You are running in Pi Lab implementation mode inside an isolated Daytona sandbox at ${runtimeWorkspace.rootPath}. You have access to read/write/edit tools. Do not use shell tools. Implement the changes described in the plan by modifying files in this repository. Pi Lab will run all test commands in this same Daytona sandbox after you finish. Do NOT create unnecessary files or make unrelated changes.${issueContext}${planContext}`,
          apiKey: runtimeKey,
          tools: ["read", "grep", "find", "ls", "write", "edit"],
          timeoutMs: input.maxWallClockSeconds * 1000,
          signal: controller.signal,
          onEvent: handleSdkEvent,
        });
      } catch (timeoutError) {
        console.warn(`[PiSdkImplRunner] timeout/cancel reached, aborting session...`);
        throw timeoutError;
      }

      clearInterval(heartbeatInterval);
      console.log(`[PiSdkImplRunner] prompt finished, total events: ${eventCount}`);

      emit({
        stage: "implement",
        kind: "status",
        payload: { status: "generating_patch" },
      });

      const patchDiff = await getRuntimeWorkspacePatch(runtimeWorkspace);

      if (patchDiff) {
        emit({
          stage: "implement",
          kind: "patch_created",
          payload: { byteSize: patchDiff.length },
        });
      }

      emit({
        stage: "evaluate",
        kind: "status",
        payload: { status: "running_tests" },
      });

      const testResults = await runTestCommandsInRuntime(input.testCommands, runtimeWorkspace);

      for (const result of testResults) {
        emit({
          stage: "evaluate",
          kind: result.passed ? "test_finished" : "test_finished",
          payload: {
            testName: result.testName,
            passed: result.passed,
            ...(result.output ? { output: result.output.slice(0, 1000) } : {}),
          },
        });
      }

      return {
        runId: input.runId,
        status: "completed",
        rawSession,
        patchDiff,
        testResults,
      };
    } catch (error) {
      if (heartbeatInterval) clearInterval(heartbeatInterval);
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[PiSdkImplRunner] caught error: ${message}`);
      emit({
        stage: "implement",
        kind: "error",
        payload: { message },
      });
      return {
        runId: input.runId,
        status: message === "Pi runner timed out" ? "timeout" : "failed",
        rawSession,
        errorMessage: message,
      };
    } finally {
      await runtimeWorkspace?.delete().catch((error: unknown) => {
        console.warn(`[PiSdkImplRunner] failed to delete Daytona workspace: ${error instanceof Error ? error.message : String(error)}`);
      });
      this.abortControllers.delete(input.runId);
    }
  }

  async abort(runId: string): Promise<void> {
    this.abortControllers.get(runId)?.abort();
  }
}

// ── Pi SDK event normalization for impl mode ───────────────────────────────

type PiSdkEventMapping = {
  event: PiRunnerEvent;
  textDelta?: string;
};

const implStatusEventTypes = new Set([
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

function normalizePiSdkEventForImpl(event: unknown): PiSdkEventMapping | null {
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
          stage: "implement",
          kind: "assistant_text_delta",
          payload: { delta },
        },
        textDelta: delta,
      };
    }

    if (assistantType === "toolcall_start") {
      return {
        event: {
          stage: "implement",
          kind: "tool_call_started",
          payload: scrubUndefined({
            toolName:
              stringValue(assistantEvent.toolName) ??
              stringValue(assistantEvent.name) ??
              "unknown",
            toolCallId:
              stringValue(assistantEvent.toolCallId) ??
              stringValue(assistantEvent.id),
          }),
        },
      };
    }

    if (assistantType === "toolcall_delta") {
      return {
        event: {
          stage: "implement",
          kind: "tool_call_delta",
          payload: { delta: assistantEvent },
        },
      };
    }

    if (assistantType === "toolcall_end") {
      return {
        event: {
          stage: "implement",
          kind: "tool_call_finished",
          payload: scrubUndefined({
            toolName:
              stringValue(assistantEvent.toolName) ??
              stringValue(assistantEvent.name) ??
              "unknown",
            toolCallId:
              stringValue(assistantEvent.toolCallId) ??
              stringValue(assistantEvent.id),
          }),
        },
      };
    }

    return null;
  }

  if (type === "tool_execution_start") {
    return {
      event: {
        stage: "implement",
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
        stage: "implement",
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
        stage: "implement",
        kind: "tool_call_finished",
        payload: scrubUndefined({
          toolName: stringValue(event.toolName) ?? "unknown",
          toolCallId: stringValue(event.toolCallId),
          isError: Boolean(event.isError),
        }),
      },
    };
  }

  if (type && implStatusEventTypes.has(type)) {
    return {
      event: {
        stage: "implement",
        kind: "status",
        payload: { status: type },
      },
    };
  }

  return null;
}

// ── Processor factory ──────────────────────────────────────────────────────

export function createPiRunnerImplProcessor(input: {
  store: PiRunnerImplStore;
  runner?: PiSdkImplRunner;
}) {
  const runner = input.runner ?? new PiSdkImplRunner();

  return async function processPiImplJob(
    job: Job<PiRunnerImplJobData, PiRunnerImplJobResult>,
  ): Promise<PiRunnerImplJobResult> {
    await job.updateProgress(
      createPiRunnerProgress("loading-run", "Loading impl run metadata"),
    );
    await input.store.markRunPreparing(job.data.runId);
    await ensurePiRunnerOutputDir(job.data.runId);

    // Load the plan from the parent plan run
    await job.updateProgress(
      createPiRunnerProgress("preparing-workspace", "Loading plan from parent run"),
    );
    const { planMarkdown } = await input.store.loadPlan(job.data.planRunId);

    // Load case version details
    const caseVersion = await input.store.loadCaseVersion(
      job.data.caseVersionId,
    );

    // Load GitHub issue content for context
    const { issueTitle, issueBody } = await input.store.loadIssueContent(
      job.data.caseVersionId,
    );

    // Create workspace directory and clone the repo
    const workspacePath = await createWorkspaceDir(job.data.runId);

    let eventCount = 0;
    await input.store.appendEvent(job.data.runId, {
      stage: "prepare",
      kind: "status",
      payload: { status: "queued", jobId: job.id },
    });
    eventCount += 1;
    await input.store.markRunRunning(job.data.runId);

    await job.updateProgress(
      createPiRunnerProgress("running-pi", "Running Pi implementation session"),
    );

    const eventWrites: Promise<number>[] = [];

    const result = await runner.runImpl(
      {
        runId: job.data.runId,
        mode: "implement",
        workspacePath,
        modelId: job.data.modelId,
        prompt: planMarkdown
          ? `## Task\n\nImplement the following plan:\n\n${planMarkdown}`
          : `## Task\n\nImplement the required changes for this case.`,
        maxTurns: job.data.maxTurns ?? 50,
        maxWallClockSeconds: job.data.maxWallClockSeconds ?? 600,
        planMarkdown,
        baseCommitSha: caseVersion.baseCommitSha,
        repoOwner: caseVersion.repoOwner,
        repoName: caseVersion.repoName,
        testCommands: caseVersion.testCommands,
        issueTitle,
        issueBody,
      },
      (event) => {
        eventCount += 1;
        eventWrites.push(input.store.appendEvent(job.data.runId, event));
      },
    );
    await Promise.all(eventWrites);

    await job.updateProgress(
      createPiRunnerProgress(
        "persisting-artifacts",
        "Persisting implementation artifacts",
      ),
    );

    const patchDiff = result.patchDiff ?? "";
    const testResults = result.testResults ?? [];

    const persisted = await input.store.persistImplResult({
      runId: job.data.runId,
      caseVersionId: job.data.caseVersionId,
      patchDiff,
      rawSession: result.rawSession ?? [],
      testResults,
    });

    await input.store.appendEvent(job.data.runId, {
      stage: "implement",
      kind: "artifact_created",
      payload: {
        kind: "predicted_patch",
        objectKey: persisted.patchArtifactKey,
      },
    });
    eventCount += 1;
    await input.store.appendEvent(job.data.runId, {
      stage: "implement",
      kind: "artifact_created",
      payload: {
        kind: "session_log",
        objectKey: persisted.rawSessionArtifactKey,
      },
    });
    eventCount += 1;

    await input.store.markRunFinished({
      runId: job.data.runId,
      status: result.status,
      ...(result.errorMessage
        ? { errorMessage: result.errorMessage }
        : {}),
    });

    await job.updateProgress(
      createPiRunnerProgress(
        result.status === "completed" ? "completed" : "failed",
        result.status === "completed"
          ? "Pi impl run completed"
          : "Pi impl run failed",
      ),
    );

    return {
      runId: job.data.runId,
      caseVersionId: job.data.caseVersionId,
      patchArtifactId: persisted.patchArtifactId,
      testResults,
      resolved: persisted.resolved,
    };
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────

async function getWorkspacePatch(workspacePath: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", workspacePath, "diff", "--"],
      { maxBuffer: 10 * 1024 * 1024 },
    );
    return stdout;
  } catch {
    return "";
  }
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Pi runner timed out")),
      timeoutMs,
    );
    const abort = () => reject(new Error("Pi runner cancelled"));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
    });
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function scrubUndefined(
  value: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  );
}

export { validateBashCommand, isPathWithinWorkspace, createWorkspaceDir, cloneRepoAtCommit };
