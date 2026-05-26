import { createBenchmarkRuntime, type RuntimeProvider, type RuntimeWorkspace } from "./index.js";
import { runSandboxPiAgent } from "./sandbox-agent.js";

const SANDBOX_ROOT = "/home/user/grader";
const OUTPUT_FILENAME = "grader-output.json";
const GRADER_TOOLS = ["read", "grep", "find", "ls"];

export type GraderContextFile = {
  /** Filename inside the grader workdir (no slashes). */
  name: string;
  content: string;
};

export type RunPiJsonGraderInput = {
  /** Display tag used in the sandbox id (e.g. "plan-grader"). */
  jobTag: string;
  apiKey: string;
  modelId: string;
  /** OpenRouter is the only provider wired up today. */
  provider?: string;
  systemPrompt: string;
  /** The instruction the agent receives as its first user message. */
  userPrompt: string;
  /** Reference materials written into the workdir before the agent starts. */
  contextFiles: GraderContextFile[];
  /** Wall-clock cap for the agent's session. Defaults to 240s. */
  maxWallClockSeconds?: number;
};

/**
 * Run a Pi agent inside a one-shot E2B sandbox, drop a set of read-only
 * context files into its workdir, and read back a structured JSON output
 * that the agent writes to `grader-output.json`.
 *
 * The agent only gets read/grep/find/ls tools — graders should not need to
 * mutate the filesystem.
 */
export async function runPiJsonGrader<T = unknown>(
  input: RunPiJsonGraderInput,
): Promise<T> {
  if (input.contextFiles.some((f) => f.name.includes("/"))) {
    throw new Error("Grader context filenames must not contain slashes");
  }

  const runtime: RuntimeProvider = createBenchmarkRuntime();
  const workspace: RuntimeWorkspace = await runtime.createWorkspace({
    id: `grader-${input.jobTag}-${randomSuffix()}`,
    timeoutMs: ((input.maxWallClockSeconds ?? 240) + 60) * 1000,
  });

  try {
    // Pre-create the workdir so context files land in a clean known location.
    const bootstrap = await workspace.run({
      command: `mkdir -p ${shellQuote(SANDBOX_ROOT)}`,
      timeoutMs: 10_000,
    });
    if (bootstrap.exitCode !== 0) {
      throw new Error(
        `Failed to create grader workdir: ${bootstrap.stderr || bootstrap.stdout}`,
      );
    }
    for (const file of input.contextFiles) {
      await workspace.writeFile({
        path: `${SANDBOX_ROOT}/${file.name}`,
        content: file.content,
      });
    }

    const controller = new AbortController();
    await runSandboxPiAgent({
      workspace,
      runId: `grader-${input.jobTag}-${randomSuffix()}`,
      provider: input.provider ?? "openrouter",
      modelName: input.modelId,
      prompt: input.userPrompt,
      systemPrompt: input.systemPrompt,
      apiKey: input.apiKey,
      tools: GRADER_TOOLS,
      timeoutMs: (input.maxWallClockSeconds ?? 240) * 1000,
      signal: controller.signal,
      cwd: SANDBOX_ROOT,
      followUpInboxPath: null,
      onEvent: () => {},
    });

    let raw: string;
    try {
      raw = await workspace.readFile(`${SANDBOX_ROOT}/${OUTPUT_FILENAME}`);
    } catch (err) {
      throw new Error(
        `Grader agent did not produce ${OUTPUT_FILENAME}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new Error(
        `Grader agent output is not valid JSON: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    return parsed as T;
  } finally {
    await workspace.delete().catch(() => undefined);
  }
}

export const GRADER_SANDBOX_ROOT = SANDBOX_ROOT;
export const GRADER_OUTPUT_FILENAME = OUTPUT_FILENAME;

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 10);
}
