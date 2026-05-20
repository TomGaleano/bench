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
  kind: "daytona" | "e2b";
  createWorkspace(input: {
    id: string;
    env?: Record<string, string>;
    timeoutMs: number;
    image?: string;
  }): Promise<RuntimeWorkspace>;
};

export type RuntimeConfig = {
  apiKey: string;
  apiUrl: string;
  target?: string;
  image?: string;
  baseImage?: string;
  language?: string;
  cpu?: number;
  memoryGb?: number;
  diskGb?: number;
  autoStopMinutes: number;
};

export function readDaytonaRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const apiKey = env.DAYTONA_API_KEY;
  if (!apiKey) {
    throw new Error("DAYTONA_API_KEY is required. Create a Daytona API key with write:sandboxes and delete:sandboxes scopes.");
  }

  return {
    apiKey,
    apiUrl: env.DAYTONA_API_URL ?? "http://localhost:3000/api",
    ...(env.DAYTONA_TARGET ? { target: env.DAYTONA_TARGET } : {}),
    ...(env.DAYTONA_IMAGE ? { image: env.DAYTONA_IMAGE } : {}),
    baseImage: env.DAYTONA_BASE_IMAGE ?? "node:22-bookworm",
    language: env.DAYTONA_LANGUAGE ?? "typescript",
    cpu: readPositiveNumber(env.DAYTONA_CPU, 2),
    memoryGb: readPositiveNumber(env.DAYTONA_MEMORY_GB, 4),
    diskGb: readPositiveNumber(env.DAYTONA_DISK_GB, 8),
    autoStopMinutes: readPositiveNumber(env.DAYTONA_AUTO_STOP_MINUTES, 15),
  };
}

export function createBenchmarkRuntime(): RuntimeProvider {
  // Default to E2B; fall back to Daytona if E2B_API_KEY is not set but DAYTONA_API_KEY is.
  const e2bKey = process.env.E2B_API_KEY;
  if (e2bKey) return createE2BRuntime();
  const daytonaKey = process.env.DAYTONA_API_KEY;
  if (daytonaKey) return createDaytonaRuntime(readDaytonaRuntimeConfig());
  throw new Error("Either E2B_API_KEY or DAYTONA_API_KEY must be set.");
}

export function createDaytonaRuntime(config: RuntimeConfig): RuntimeProvider {
  return {
    kind: "daytona",
    async createWorkspace(input) {
      const { Daytona, Image } = await import("@daytona/sdk");
      const client = new Daytona({
        apiKey: config.apiKey,
        apiUrl: config.apiUrl,
        ...(config.target ? { target: config.target } : {}),
      });

      const resources: Record<string, number> = {};
      if (config.cpu !== undefined) resources.cpu = config.cpu;
      if (config.memoryGb !== undefined) resources.memory = config.memoryGb;
      if (config.diskGb !== undefined) resources.disk = config.diskGb;
      const resolvedImage = input.image ?? config.image ?? Image.base(config.baseImage ?? "node:22-bookworm");
      const createParams = {
        name: input.id,
        image: resolvedImage,
        ...(!config.image ? { language: config.language } : {}),
        ephemeral: true,
        autoStopInterval: config.autoStopMinutes,
        autoDeleteInterval: 0,
        ...(Object.keys(resources).length > 0 ? { resources } : {}),
        envVars: {
          CI: "true",
          ...input.env,
        },
      };
      const sandbox = await client.create(createParams as never, {
        timeout: Math.max(60, Math.ceil(input.timeoutMs / 1000)),
      } as never);

      const rootPath = "/home/daytona/workspace";
      const workspace = createDaytonaWorkspace({ sandbox, id: input.id, rootPath });
      const init = await workspace.run({
        command: `printf 'nameserver 8.8.8.8\\nnameserver 1.1.1.1\\noptions edns0 trust-ad ndots:0\\n' > /etc/resolv.conf && mkdir -p ${shellQuote(rootPath)}`,
        cwd: "/",
        timeoutMs: input.timeoutMs,
      });
      if (init.exitCode !== 0) {
        await workspace.delete().catch(() => undefined);
        throw new Error(`Failed to initialize Daytona workspace: ${init.stderr || init.stdout || `exit ${init.exitCode}`}`);
      }
      return workspace;
    },
  };
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
      const { exitCode, stdout, stderr, error } = await sandbox.commands.run(commandInput.command, {
        cwd: commandInput.cwd ?? rootPath,
        ...(commandInput.env ? { envs: commandInput.env } : {}),
        timeoutMs: commandInput.timeoutMs,
      });
      return {
        exitCode: exitCode ?? (error ? 1 : 0),
        stdout: stdout ?? "",
        stderr: stderr ?? error ?? "",
        timedOut: false,
      };
    },
    async runStreaming(commandInput) {
      let fullStdout = "";
      let fullStderr = "";

      const { exitCode, stdout, stderr, error } = await sandbox.commands.run(commandInput.command, {
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
        exitCode: exitCode ?? (error ? 1 : 0),
        stdout: fullStdout || stdout || "",
        stderr: fullStderr || stderr || error || "",
        timedOut: false,
      };
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

function createDaytonaWorkspace(input: {
  sandbox: unknown;
  id: string;
  rootPath: string;
}): RuntimeWorkspace {
  const sandbox = input.sandbox as {
    process: {
      executeCommand(command: string, cwd?: string, env?: Record<string, string>, timeout?: number): Promise<{ exitCode?: number; result?: string }>;
      createSession(sessionId: string): Promise<void>;
      executeSessionCommand(
        sessionId: string,
        req: { command: string; runAsync?: boolean; env?: Record<string, string> },
        timeout?: number,
      ): Promise<{ cmdId?: string; exitCode?: number; stdout?: string; stderr?: string; output?: string }>;
      getSessionCommandLogs(
        sessionId: string,
        commandId: string,
        onStdout: (chunk: string) => void,
        onStderr: (chunk: string) => void,
      ): Promise<void>;
      getSessionCommand(sessionId: string, commandId: string): Promise<{ exitCode?: number }>;
      deleteSession(sessionId: string): Promise<void>;
    };
    fs: {
      uploadFile(source: Buffer, destination: string): Promise<void>;
      downloadFile(source: string): Promise<Buffer>;
      setFilePermissions(path: string, permissions: { mode: string }): Promise<void>;
    };
    delete(): Promise<void>;
  };

  return {
    id: input.id,
    rootPath: input.rootPath,
    async run(commandInput) {
      // Use session commands so stderr is captured (executeCommand drops stderr).
      const sessionId = `pilab-${input.id}-${Date.now().toString(36)}-run`.replace(/[^a-zA-Z0-9_-]/g, "-");
      let stdout = "";
      let stderr = "";
      try {
        await sandbox.process.createSession(sessionId);
        const envPrefix = commandInput.env
          ? `${Object.entries(commandInput.env)
              .filter(([key]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key))
              .map(([key, value]) => `${key}=${shellQuote(value)}`)
              .join(" ")} `
          : "";
        const commandBody = commandInput.cwd
          ? `cd ${shellQuote(commandInput.cwd)} && ${envPrefix}${commandInput.command}`
          : `${envPrefix}${commandInput.command}`;
        const command = `bash -lc ${shellQuote(`set +e; ${commandBody}; __pilab_exit=$?; printf '\nPILAB_RUNTIME_EXIT_CODE=%s\n' "$__pilab_exit"; exit "$__pilab_exit"`)}`;
        const response = await sandbox.process.executeSessionCommand(
          sessionId,
          { command, runAsync: true },
          Math.max(1, Math.ceil(commandInput.timeoutMs / 1000)),
        );
        if (!response.cmdId) {
          return {
            exitCode: response.exitCode ?? 1,
            stdout: response.stdout ?? response.output ?? "",
            stderr: response.stderr ?? "Daytona did not return a session command id.",
            timedOut: false,
          };
        }

        const logsDone = sandbox.process.getSessionCommandLogs(
          sessionId,
          response.cmdId,
          (chunk) => { stdout += chunk; },
          (chunk) => { stderr += chunk; },
        ).catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          if (message) stderr += stderr ? `\n${message}` : message;
        });
        const startedAt = Date.now();
        let completed = await sandbox.process.getSessionCommand(sessionId, response.cmdId);
        while (completed.exitCode === undefined && Date.now() - startedAt < commandInput.timeoutMs) {
          await delay(1_000);
          completed = await sandbox.process.getSessionCommand(sessionId, response.cmdId);
        }
        await Promise.race([logsDone, delay(1_000)]);
        const observedExitCode = parseRuntimeExitCode(stdout);
        return {
          exitCode: observedExitCode ?? completed.exitCode ?? 1,
          stdout: stripRuntimeExitCode(stdout),
          stderr,
          timedOut: observedExitCode === undefined && completed.exitCode === undefined,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          exitCode: 1,
          stdout,
          stderr: stderr || message,
          timedOut: /timeout|timed out/i.test(message),
        };
      } finally {
        await sandbox.process.deleteSession(sessionId).catch(() => undefined);
      }
    },
    async runStreaming(commandInput) {
      const sessionId = `pilab-${input.id}-${Date.now().toString(36)}`.replace(/[^a-zA-Z0-9_-]/g, "-");
      let stdout = "";
      let stderr = "";
      try {
        await sandbox.process.createSession(sessionId);
        const envPrefix = commandInput.env
          ? `${Object.entries(commandInput.env)
              .filter(([key]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key))
              .map(([key, value]) => `${key}=${shellQuote(value)}`)
              .join(" ")} `
          : "";
        const commandBody = commandInput.cwd
          ? `cd ${shellQuote(commandInput.cwd)} && ${envPrefix}${commandInput.command}`
          : `${envPrefix}${commandInput.command}`;
        const command = `bash -lc ${shellQuote(`set +e; ${commandBody}; __pilab_exit=$?; printf '\nPILAB_RUNTIME_EXIT_CODE=%s\n' "$__pilab_exit"; exit "$__pilab_exit"`)}`;
        const response = await sandbox.process.executeSessionCommand(
          sessionId,
          { command, runAsync: true },
          Math.max(1, Math.ceil(commandInput.timeoutMs / 1000)),
        );
        if (!response.cmdId) {
          return {
            exitCode: response.exitCode ?? 1,
            stdout: response.stdout ?? response.output ?? "",
            stderr: response.stderr ?? "Daytona did not return a session command id.",
            timedOut: false,
          };
        }

        const logsDone = sandbox.process.getSessionCommandLogs(
          sessionId,
          response.cmdId,
          (chunk) => {
            stdout += chunk;
            commandInput.onStdout?.(chunk);
          },
          (chunk) => {
            stderr += chunk;
            commandInput.onStderr?.(chunk);
          },
        ).catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          if (message) stderr += stderr ? `\n${message}` : message;
        });
        const startedAt = Date.now();
        let completed = await sandbox.process.getSessionCommand(sessionId, response.cmdId);
        while (completed.exitCode === undefined && Date.now() - startedAt < commandInput.timeoutMs) {
          await delay(1_000);
          completed = await sandbox.process.getSessionCommand(sessionId, response.cmdId);
        }
        await Promise.race([logsDone, delay(1_000)]);
        const observedExitCode = parseRuntimeExitCode(stdout);
        return {
          exitCode: observedExitCode ?? completed.exitCode ?? 1,
          stdout: stripRuntimeExitCode(stdout),
          stderr,
          timedOut: observedExitCode === undefined && completed.exitCode === undefined,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          exitCode: 1,
          stdout,
          stderr: stderr || message,
          timedOut: /timeout|timed out/i.test(message),
        };
      } finally {
        await sandbox.process.deleteSession(sessionId).catch(() => undefined);
      }
    },
    async writeFile(fileInput) {
      assertSafeRelativePath(fileInput.path);
      const destination = `${input.rootPath}/${fileInput.path}`;
      const mkdirResult = await this.run({
        command: `mkdir -p ${shellQuote(destination.slice(0, destination.lastIndexOf("/")))}`,
        timeoutMs: 10_000,
      });
      if (mkdirResult.exitCode !== 0) {
        throw new Error(`Failed to create remote directory: ${mkdirResult.stderr || mkdirResult.stdout}`);
      }
      await sandbox.fs.uploadFile(Buffer.from(fileInput.content), destination);
      if (fileInput.mode) {
        await sandbox.fs.setFilePermissions(destination, { mode: fileInput.mode });
      }
    },
    async readFile(filePath) {
      assertSafeRelativePath(filePath);
      const content = await sandbox.fs.downloadFile(`${input.rootPath}/${filePath}`);
      return content.toString("utf8");
    },
    async delete() {
      await sandbox.delete();
    },
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRuntimeExitCode(output: string): number | undefined {
  const matches = [...output.matchAll(/^PILAB_RUNTIME_EXIT_CODE=(\d+)$/gm)];
  const last = matches.at(-1)?.[1];
  return last ? Number.parseInt(last, 10) : undefined;
}

function stripRuntimeExitCode(output: string): string {
  return output.replace(/^PILAB_RUNTIME_EXIT_CODE=\d+\n?/gm, "");
}

function readPositiveNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
