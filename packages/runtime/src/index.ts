export type RuntimeCommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

export type RuntimeStreamHandlers = {
  onStdout?(chunk: string): void;
  onStderr?(chunk: string): void;
};

export type RuntimeWorkspace = {
  id: string;
  rootPath: string;
  run(input: {
    command: string;
    cwd?: string;
    timeoutMs: number;
    env?: Record<string, string>;
  }): Promise<RuntimeCommandResult>;
  runStreaming(input: {
    command: string;
    cwd?: string;
    timeoutMs: number;
    env?: Record<string, string>;
  } & RuntimeStreamHandlers): Promise<RuntimeCommandResult>;
  writeFile(input: { path: string; content: string; mode?: string }): Promise<void>;
  readFile(path: string): Promise<string>;
  delete(): Promise<void>;
};

export type RuntimeProvider = {
  kind: "e2b";
  createWorkspace(input: {
    id: string;
    env?: Record<string, string>;
    timeoutMs: number;
  }): Promise<RuntimeWorkspace>;
};

export function createBenchmarkRuntime(): RuntimeProvider {
  if (!process.env.E2B_API_KEY) {
    throw new Error("E2B_API_KEY is required. Get one at https://e2b.dev/dashboard");
  }
  return createE2BRuntime();
}

/**
 * Create a runtime provider backed by E2B cloud sandboxes.
 * Requires the `E2B_API_KEY` environment variable.
 *
 * E2B provides reliable cloud sandboxes with native stderr support and
 * a robust gRPC-based API — no DNS workarounds needed.
 */
export function createE2BRuntime(): RuntimeProvider {
  const apiKey = process.env.E2B_API_KEY;
  if (!apiKey) throw new Error("E2B_API_KEY is required. Get one at https://e2b.dev/dashboard");

  return {
    kind: "e2b",
    async createWorkspace(input): Promise<RuntimeWorkspace> {
      const e2bModule = await import("e2b");
      const Sandbox = e2bModule.Sandbox ?? e2bModule.default;

      const s = await Sandbox.create({
        ...(input.timeoutMs ? { timeoutMs: input.timeoutMs } : {}),
        ...(input.env ? { envs: { CI: "true", ...input.env } } : { envs: { CI: "true" } }),
      });

      return createE2BWorkspace(s);
    },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createE2BWorkspace(sandbox: any): RuntimeWorkspace {
  const id = sandbox.sandboxId;
  const rootPath = "/home/user";  // E2B sandbox default working directory

  return {
    id,
    rootPath,
    async run(commandInput) {
      try {
        const result = await sandbox.commands.run(commandInput.command, {
          cwd: commandInput.cwd ?? rootPath,
          ...(commandInput.env ? { envs: commandInput.env } : {}),
          timeoutMs: commandInput.timeoutMs,
        });
        return {
          exitCode: result.exitCode ?? 0,
          stdout: result.stdout ?? "",
          stderr: result.stderr ?? "",
          timedOut: false,
        };
      } catch (err) {
        // E2B throws CommandExitError for non-zero exit codes — extract the actual result
        if (err && typeof err === "object" && "exitCode" in (err as Record<string, unknown>)) {
          const cmdErr = err as { exitCode: number; stdout: string; stderr: string; error?: string };
          const errStdout = cmdErr.stdout ?? "";
          const errStderr = cmdErr.stderr ?? "";
          return {
            exitCode: cmdErr.exitCode ?? 1,
            stdout: errStdout,
            // Stderr often carries only "exit status 1" from E2B — combine with stdout
            // to capture pip build errors that get written to stdout.
            stderr: errStderr || errStdout || cmdErr.error || "",
            timedOut: false,
          };
        }
        const msg = err instanceof Error ? err.message : String(err);
        return {
          exitCode: 1,
          stdout: "",
          stderr: msg,
          timedOut: msg.includes("timeout") || msg.includes("timed out"),
        };
      }
    },
    async runStreaming(commandInput) {
      let fullStdout = "";
      let fullStderr = "";

      try {
        const result = await sandbox.commands.run(commandInput.command, {
          cwd: commandInput.cwd ?? rootPath,
          ...(commandInput.env ? { envs: commandInput.env } : {}),
          timeoutMs: commandInput.timeoutMs,
          onStdout(chunk: string) {
            fullStdout += chunk;
            commandInput.onStdout?.(chunk);
          },
          onStderr(chunk: string) {
            fullStderr += chunk;
            commandInput.onStderr?.(chunk);
          },
        });
        return {
          exitCode: result.exitCode ?? 0,
          stdout: fullStdout || result.stdout || "",
          stderr: fullStderr || result.stderr || "",
          timedOut: false,
        };
      } catch (err) {
        if (err && typeof err === "object" && "exitCode" in (err as Record<string, unknown>)) {
          const cmdErr = err as { exitCode: number; stdout: string; stderr: string };
          return {
            exitCode: cmdErr.exitCode ?? 1,
            stdout: fullStdout || cmdErr.stdout || "",
            stderr: fullStderr || cmdErr.stderr || "",
            timedOut: false,
          };
        }
        return {
          exitCode: 1,
          stdout: fullStdout,
          stderr: fullStderr || (err instanceof Error ? err.message : String(err)),
          timedOut: false,
        };
      }
    },
    async writeFile(fileInput) {
      await sandbox.files.write(fileInput.path, fileInput.content);
    },
    async readFile(filePath) {
      return sandbox.files.read(filePath, { format: "text" });
    },
    async delete() {
      await sandbox.kill();
    },
  };
}

export async function cloneRepoAtCommitInRuntime(input: {
  runtime: RuntimeProvider;
  workspaceId: string;
  repoUrl: string;
  commitSha: string;
  timeoutMs: number;
  env?: Record<string, string>;
  image?: string;
}): Promise<RuntimeWorkspace> {
  const workspaceInput: { id: string; timeoutMs: number; env?: Record<string, string>; image?: string } = {
    id: input.workspaceId,
    timeoutMs: input.timeoutMs,
  };
  if (input.env) workspaceInput.env = input.env;
  if (input.image) workspaceInput.image = input.image;
  const workspace = await input.runtime.createWorkspace(workspaceInput);

  const maxRetries = 5;
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // On retry, if the working tree is dirty from a prior failed fetch, reset it first
      const resetCmd = attempt > 1 ? `cd ${shellQuote(workspace.rootPath)} && git reset --hard HEAD 2>/dev/null; true && ` : "";
      // remote add is idempotent: if origin already exists (from a prior retry), set-url instead
      const command = [
        "set -euo pipefail",
        `${resetCmd}git init ${shellQuote(workspace.rootPath)}`,
        `git -C ${shellQuote(workspace.rootPath)} remote add origin ${shellQuote(input.repoUrl)} 2>/dev/null || git -C ${shellQuote(workspace.rootPath)} remote set-url origin ${shellQuote(input.repoUrl)}`,
        `git -C ${shellQuote(workspace.rootPath)} fetch --depth=1 origin ${shellQuote(input.commitSha)}`,
        `git -C ${shellQuote(workspace.rootPath)} checkout --detach FETCH_HEAD`,
      ].join(" && ");
      const result = await workspace.run({ command, timeoutMs: input.timeoutMs });
      if (result.exitCode !== 0) {
        const isRetryable =
          attempt < maxRetries &&
          (result.stderr.includes("Could not resolve host") ||
            result.stderr.includes("Name or service not known") ||
            result.stderr.includes("Temporary failure") ||
            result.stderr.includes("timed out") ||
            result.stderr.includes("Connection reset") ||
            result.stderr.includes("SSL") ||
            result.stderr.includes("remote origin already exists"));
        if (isRetryable) {
          lastError = new Error(result.stderr || result.stdout || `git checkout failed with exit ${result.exitCode}`);
          // Exponential backoff: 2s, 4s, 8s, 16s
          await delay(2_000 * Math.pow(2, attempt - 1));
          continue;
        }
        throw new Error(result.stderr || result.stdout || `git checkout failed with exit ${result.exitCode}`);
      }
      return workspace;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < maxRetries) {
        // Retry on any error with exponential backoff
        await delay(2_000 * Math.pow(2, attempt - 1));
        continue;
      }
      await workspace.delete().catch(() => undefined);
      throw lastError;
    }
  }

  await workspace.delete().catch(() => undefined);
  throw lastError ?? new Error("cloneRepoAtCommitInRuntime failed after all retries");
}

export function assertSafeRelativePath(filePath: string): void {
  if (!filePath || filePath.startsWith("/") || filePath.includes("..") || filePath.includes("\0")) {
    throw new Error(`Unsafe runtime path: ${filePath}`);
  }
}

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
