import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { DbClient } from "@pilab/db";
import { reproductionSteps, caseVersions, validationAttempts } from "@pilab/db";
import { eq } from "drizzle-orm";
import {
  createReproductionValidatorProgress,
  type ReproductionValidatorJobData,
  type ReproductionValidatorJobResult,
} from "@pilab/jobs";
import {
  cloneRepoAtCommitInRuntime,
  createBenchmarkRuntime,
  type RuntimeWorkspace,
} from "@pilab/runtime";

const execFileAsync = promisify(execFile);

type JsonRecord = Record<string, unknown>;

export type ReproductionValidatorStore = {
  findReproductionStepsById(id: string): Promise<{
    id: string;
    caseVersionId: string;
    validationAttemptId: string;
    script: string;
    steps: { description: string; command: string }[];
    rationale: string;
  } | undefined>;
  findCaseVersionById(id: string): Promise<{
    id: string;
    repoOwner: string;
    repoName: string;
    baseCommitSha: string;
    goldCommitSha: string | null;
    setupCommands: string[];
    environmentRecipe: JsonRecord;
  } | undefined>;
  finishAttempt(input: {
    attemptId: string;
    caseVersionId: string;
    reproductionStepsId: string;
    status: "accepted" | "rejected" | "error";
    rawResults: JsonRecord;
    validationLogArtifactId?: string;
    reproducedOnBase?: boolean;
    fixedOnGold?: boolean;
  }): Promise<void>;
};

export function createDrizzleReproductionValidatorStore(db: DbClient): ReproductionValidatorStore {
  return {
    async findReproductionStepsById(id) {
      const row = await db.query.reproductionSteps.findFirst({
        where: eq(reproductionSteps.id, id),
      });
      if (!row) return undefined;
      return {
        id: row.id,
        caseVersionId: row.caseVersionId,
        validationAttemptId: row.validationAttemptId ?? "",
        script: row.script,
        steps: row.steps as { description: string; command: string }[],
        rationale: row.rationale ?? "",
      };
    },
    async findCaseVersionById(id) {
      const row = await db.query.caseVersions.findFirst({
        where: eq(caseVersions.id, id),
      });
      if (!row) return undefined;
      return {
        id: row.id,
        repoOwner: row.repoOwner,
        repoName: row.repoName,
        baseCommitSha: row.baseCommitSha,
        goldCommitSha: row.goldCommitSha,
        setupCommands: row.setupCommands as string[],
        environmentRecipe: row.environmentRecipe as JsonRecord,
      };
    },
    async finishAttempt(input) {
      await db
        .update(validationAttempts)
        .set({
          status: input.status,
          rawResults: input.rawResults,
          finishedAt: new Date(),
          ...(input.validationLogArtifactId
            ? { validationLogArtifactId: input.validationLogArtifactId }
            : {}),
        })
        .where(eq(validationAttempts.id, input.attemptId));

      await db
        .update(caseVersions)
        .set({ status: input.status === "accepted" ? "candidate" : "rejected" })
        .where(eq(caseVersions.id, input.caseVersionId));

      await db
        .update(reproductionSteps)
        .set({
          status: input.status === "accepted" ? "accepted" : "rejected",
          reproducedOnBase: input.reproducedOnBase,
          fixedOnGold: input.fixedOnGold,
          rawResults: input.rawResults,
        })
        .where(eq(reproductionSteps.id, input.reproductionStepsId));
    },
  };
}

export function createReproductionValidatorProcessor(input: {
  store: ReproductionValidatorStore;
  modelId?: string;
  maxWallClockSeconds?: number;
}) {
  const modelId = input.modelId ?? process.env.REPRODUCTION_VALIDATOR_MODEL_ID ?? process.env.TEST_BUILDER_MODEL_ID ?? "openai/gpt-5.4-mini";
  const maxWallClockSeconds = input.maxWallClockSeconds ?? 300;

  return async (job: {
    data: ReproductionValidatorJobData;
    updateProgress(progress: ReturnType<typeof createReproductionValidatorProgress>): Promise<void>;
  }): Promise<ReproductionValidatorJobResult> => {
    const startedAt = new Date().toISOString();

    try {
      await job.updateProgress(
        createReproductionValidatorProgress("loading-reproduction-steps", "Loading reproduction steps"),
      );

      const stepsRecord = await input.store.findReproductionStepsById(job.data.reproductionStepsId);
      if (!stepsRecord) {
        throw new Error(`Reproduction steps not found: ${job.data.reproductionStepsId}`);
      }

      const caseVersion = await input.store.findCaseVersionById(job.data.caseVersionId);
      if (!caseVersion) {
        throw new Error(`Case version not found: ${job.data.caseVersionId}`);
      }

      if (!caseVersion.goldCommitSha) {
        throw new Error(`Case version has no gold commit: ${caseVersion.id}`);
      }

      await job.updateProgress(
        createReproductionValidatorProgress("cloning-repository", "Cloning repository at base and gold commits"),
      );

      let baseWorkspace: RuntimeWorkspace | undefined;
      let goldWorkspace: RuntimeWorkspace | undefined;

      try {
        const runtime = createBenchmarkRuntime();
        const repoUrl = `https://github.com/${caseVersion.repoOwner}/${caseVersion.repoName}.git`;
        [baseWorkspace, goldWorkspace] = await Promise.all([
          cloneRepoAtCommitInRuntime({
            runtime,
            workspaceId: `repro-base-${stepsRecord.id}`,
            repoUrl,
            commitSha: caseVersion.baseCommitSha,
            timeoutMs: maxWallClockSeconds * 1000,
            env: { CI: "true" },
          }),
          cloneRepoAtCommitInRuntime({
            runtime,
            workspaceId: `repro-gold-${stepsRecord.id}`,
            repoUrl,
            commitSha: caseVersion.goldCommitSha,
            timeoutMs: maxWallClockSeconds * 1000,
            env: { CI: "true" },
          }),
        ]);

        await job.updateProgress(
          createReproductionValidatorProgress("running-agent-on-base", "Running reproduction script in base Daytona sandbox"),
        );

        const baseResult = await runReproductionScriptInRuntime({
          workspace: baseWorkspace,
          script: stepsRecord.script,
          maxWallClockSeconds,
        });

        await job.updateProgress(
          createReproductionValidatorProgress("running-agent-on-gold", "Running reproduction script in gold Daytona sandbox"),
        );

        const goldResult = await runReproductionScriptInRuntime({
          workspace: goldWorkspace,
          script: stepsRecord.script,
          maxWallClockSeconds,
        });

        const reproducedOnBase = baseResult.exitCode !== 0;
        const fixedOnGold = goldResult.exitCode === 0;
        const accepted = reproducedOnBase && fixedOnGold;

        const completedAt = new Date().toISOString();
        const rawResults = {
          source: "reproduction-validator",
          startedAt,
          completedAt,
          base: {
            exitCode: baseResult.exitCode,
            stdout: baseResult.stdout,
            stderr: baseResult.stderr,
            agentStatus: baseResult.agentStatus,
          },
          gold: {
            exitCode: goldResult.exitCode,
            stdout: goldResult.stdout,
            stderr: goldResult.stderr,
            agentStatus: goldResult.agentStatus,
          },
          reproducedOnBase,
          fixedOnGold,
        };

        await input.store.finishAttempt({
          attemptId: job.data.validationAttemptId,
          caseVersionId: caseVersion.id,
          reproductionStepsId: stepsRecord.id,
          status: accepted ? "accepted" : "rejected",
          rawResults,
          reproducedOnBase,
          fixedOnGold,
        });

        await job.updateProgress(
          createReproductionValidatorProgress(
            accepted ? "accepted" : "rejected",
            accepted
              ? "Reproduction validated successfully"
              : "Reproduction validation failed",
          ),
        );

        return {
          caseVersionId: caseVersion.id,
          reproductionStepsId: stepsRecord.id,
          validationAttemptId: job.data.validationAttemptId,
          status: accepted ? "accepted" : "rejected",
          reproducedOnBase,
          fixedOnGold,
          baseExitCode: baseResult.exitCode,
          goldExitCode: goldResult.exitCode,
          completedAt,
        };
      } finally {
        await Promise.all([
          baseWorkspace?.delete().catch(() => undefined),
          goldWorkspace?.delete().catch(() => undefined),
        ]);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await job.updateProgress(
        createReproductionValidatorProgress("error", message),
      );

      await input.store.finishAttempt({
        attemptId: job.data.validationAttemptId,
        caseVersionId: job.data.caseVersionId,
        reproductionStepsId: job.data.reproductionStepsId,
        status: "error",
        rawResults: { source: "reproduction-validator", startedAt, error: message },
        reproducedOnBase: false,
        fixedOnGold: false,
      });

      return {
        caseVersionId: job.data.caseVersionId,
        reproductionStepsId: job.data.reproductionStepsId,
        validationAttemptId: job.data.validationAttemptId,
        status: "error",
        reproducedOnBase: false,
        fixedOnGold: false,
        baseExitCode: -1,
        goldExitCode: -1,
        completedAt: new Date().toISOString(),
        errorMessage: message,
      };
    }
  };
}

async function runReproductionScriptInRuntime(input: {
  workspace: RuntimeWorkspace;
  script: string;
  maxWallClockSeconds: number;
}): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
  agentStatus: "completed" | "failed" | "timeout";
}> {
  await input.workspace.writeFile({
    path: ".pilab-repro",
    content: input.script,
    mode: "755",
  });
  const result = await input.workspace.run({
    command: "./.pilab-repro",
    cwd: input.workspace.rootPath,
    timeoutMs: input.maxWallClockSeconds * 1000,
    env: { CI: "true" },
  });

  return {
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    agentStatus: result.timedOut ? "timeout" : result.exitCode === 0 ? "completed" : "failed",
  };
}

async function runPiAgentValidation(input: {
  workspacePath: string;
  script: string;
  modelId: string;
  maxWallClockSeconds: number;
}): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
  agentStatus: "completed" | "failed" | "timeout";
}> {
  const pi = await import("@mariozechner/pi-coding-agent");
  const provider = "openrouter";
  const apiKey = process.env.OPENROUTER_API_KEY ?? "";

  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is required for reproduction validator");
  }

  const authStorage = pi.AuthStorage.create(path.join(input.workspacePath, ".pi-auth.json"));
  authStorage.setRuntimeApiKey(provider, apiKey);

  const modelRegistry = pi.ModelRegistry.create(authStorage);
  const modelNames = input.modelId.startsWith(`${provider}/`)
    ? [input.modelId.slice(provider.length + 1), input.modelId]
    : [input.modelId];
  const model = modelNames
    .map((modelName) => modelRegistry.find(provider, modelName))
    .find((candidate) => Boolean(candidate));

  if (!model) {
    throw new Error(`Pi model not found: ${provider}/${input.modelId}`);
  }

  const scriptPath = path.join(input.workspacePath, ".pilab-repro");
  await writeFile(scriptPath, input.script, "utf8");

  const wrapperScript = `#!/bin/bash\nbash .pilab-repro\necho "PILAB_EXIT_CODE=$?"`;
  const wrapperPath = path.join(input.workspacePath, ".pilab-repro-wrapper");
  await writeFile(wrapperPath, wrapperScript, "utf8");

  const settingsManager = pi.SettingsManager.inMemory({
    compaction: { enabled: false },
    retry: { enabled: true, maxRetries: 1 },
  });

  const systemPrompt = [
    "You are a validation agent. Your sole task is to run a reproduction script and report whether it succeeds or fails.",
    "Do not explore the codebase. Do not modify files. Do not ask questions.",
    "Simply run the provided script and observe the result.",
  ].join(" ");

  const resourceLoader = new pi.DefaultResourceLoader({
    cwd: input.workspacePath,
    agentDir: path.join(input.workspacePath, ".pi-agent"),
    settingsManager,
    systemPromptOverride: () => systemPrompt,
  });
  await resourceLoader.reload();

  const { session } = await pi.createAgentSession({
    cwd: input.workspacePath,
    agentDir: path.join(input.workspacePath, ".pi-agent"),
    model,
    thinkingLevel: "off",
    authStorage,
    modelRegistry,
    tools: ["read", "bash"],
    resourceLoader,
    sessionManager: pi.SessionManager.inMemory(input.workspacePath),
    settingsManager,
  });

  const rawEvents: Array<Record<string, unknown>> = [];
  let lastBashResult: { exitCode: number | undefined; stdout: string | undefined; stderr: string | undefined } = {
    exitCode: undefined,
    stdout: undefined,
    stderr: undefined,
  };
  let agentStatus: "completed" | "failed" | "timeout" = "completed";

  session.subscribe((event: Record<string, unknown>) => {
    rawEvents.push(event);

    if (event.type === "tool_execution_end" && event.toolName === "bash") {
      lastBashResult = {
        exitCode: typeof event.exitCode === "number" ? event.exitCode : undefined,
        stdout: typeof event.stdout === "string" ? event.stdout : undefined,
        stderr: typeof event.stderr === "string" ? event.stderr : undefined,
      };
    }
  });

  const prompt = `Run the reproduction script with:\n\nbash .pilab-repro-wrapper\n\nWait for it to complete. The script output will include a line like PILAB_EXIT_CODE=N. Report what you see.`;

  try {
    await withTimeout(
      (async () => {
        await session.prompt(prompt);
        await session.agent.waitForIdle();
      })(),
      input.maxWallClockSeconds * 1000,
    );
  } catch (timeoutError) {
    agentStatus = "timeout";
    session.abort().catch(() => {});
  }

  session.dispose();

  // Try to extract exit code from raw events or wrapper output
  let exitCode = lastBashResult.exitCode ?? 1;
  let stdout = lastBashResult.stdout ?? "";
  let stderr = lastBashResult.stderr ?? "";

  let match = stdout.match(/PILAB_EXIT_CODE=(\d+)/);

  if (!match) {
    const directResult = await runWrapperDirectly({
      workspacePath: input.workspacePath,
      wrapperPath,
      maxWallClockSeconds: input.maxWallClockSeconds,
    });
    stdout = [stdout, directResult.stdout].filter(Boolean).join("\n");
    stderr = [
      stderr,
      "Pi agent did not expose PILAB_EXIT_CODE; ran wrapper directly as a fallback.",
      directResult.stderr,
    ]
      .filter(Boolean)
      .join("\n");
    match = stdout.match(/PILAB_EXIT_CODE=(\d+)/);
  }

  if (match && match[1]) {
    exitCode = Number.parseInt(match[1], 10);
  } else if (agentStatus === "completed") {
    exitCode = 1;
    stderr = [stderr, "PILAB_EXIT_CODE marker was not observed in agent bash output"]
      .filter(Boolean)
      .join("\n");
  }

  return { exitCode, stdout, stderr, agentStatus };
}

async function runWrapperDirectly(input: {
  workspacePath: string;
  wrapperPath: string;
  maxWallClockSeconds: number;
}): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execFileAsync("bash", [input.wrapperPath], {
      cwd: input.workspacePath,
      timeout: input.maxWallClockSeconds * 1000,
      maxBuffer: 1024 * 1024,
    });
  } catch (error) {
    if (isExecError(error)) {
      return {
        stdout: error.stdout ?? "",
        stderr: error.stderr ?? error.message,
      };
    }
    return {
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
    };
  }
}

function isExecError(error: unknown): error is Error & { stdout?: string; stderr?: string } {
  return error instanceof Error;
}

async function cloneRepoAtCommit(
  owner: string,
  repo: string,
  commitSha: string,
  targetPath: string,
): Promise<void> {
  const repoUrl = `https://github.com/${owner}/${repo}.git`;
  await mkdir(targetPath, { recursive: true });

  // Clone into a temp subdir then move, because git clone wants an empty dir
  const cloneResult = await execFileAsync("git", ["clone", "--depth=1", repoUrl, targetPath]);
  if (cloneResult.stderr) {
    console.warn(`[reproduction-validator] clone stderr: ${cloneResult.stderr.slice(0, 200)}`);
  }

  // Fetch the specific commit if it's not the default branch HEAD
  await execFileAsync("git", ["-C", targetPath, "fetch", "--depth=1", "origin", commitSha]);
  await execFileAsync("git", ["-C", targetPath, "checkout", commitSha]);
}

async function cleanupDir(dir: string): Promise<void> {
  try {
    await execFileAsync("rm", ["-rf", dir]);
  } catch {
    // ignore cleanup errors
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Reproduction validator timed out")), ms),
    ),
  ]);
}
