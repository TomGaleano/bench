import { shellQuote, type RuntimeWorkspace } from "./index.js";

export async function runSandboxPiAgent(input: {
  workspace: RuntimeWorkspace;
  runId: string;
  provider: string;
  modelName: string;
  prompt: string;
  systemPrompt: string;
  apiKey: string;
  tools: string[];
  timeoutMs: number;
  signal: AbortSignal;
  onEvent(event: unknown): void;
  /**
   * Optional working directory inside the sandbox. When set, the agent runs
   * from this path (useful for git-worktree-per-agent setups) and the Pi SDK
   * sees this as its `cwd`. Defaults to `workspace.rootPath`.
   */
  cwd?: string;
  /**
   * Optional absolute path inside the sandbox for the JSONL follow-up inbox.
   * When set, the script keeps the Pi session alive after the first prompt
   * completes and tails this file for additional turns (`{ "text": "..." }`
   * lines). Send `{ "done": true }` to exit cleanly. Defaults to
   * `${cwd}/.pilab-followups.jsonl`. If you don't want follow-up support,
   * pass `null` and the script exits as soon as the first prompt resolves.
   */
  followUpInboxPath?: string | null;
}): Promise<void> {
  const cwd = input.cwd ?? input.workspace.rootPath;
  const runtimeDir = `${cwd}/.pilab-agent-runtime`;
  const followUpInboxPath =
    input.followUpInboxPath === null
      ? null
      : input.followUpInboxPath ?? `${cwd}/.pilab-followups.jsonl`;
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
      workspacePath: cwd,
      tools: input.tools,
      followUpInboxPath,
    }),
  });
  if (followUpInboxPath) {
    // Pre-create the inbox so the script's stat() loop has something to read
    // before any follow-up has been written.
    await input.workspace.writeFile({ path: followUpInboxPath, content: "" });
  }
  await input.workspace.writeFile({
    path: `${runtimeDir}/run-pi-agent.mjs`,
    content: runtimePiAgentScript(),
  });

  await installPiAgentRuntime(input.workspace, runtimeDir, cwd);

  await withTimeout(
    new Promise<void>((resolve, reject) => {
      const parseStdout = createSandboxEventParser(input.onEvent, reject);
      input.workspace.runStreaming({
        command: `node ${shellQuote(`${runtimeDir}/run-pi-agent.mjs`)}`,
        cwd,
        timeoutMs: input.timeoutMs,
        env: { CI: "true", OPENROUTER_API_KEY: input.apiKey },
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

/**
 * `npm install @mariozechner/pi-coding-agent` pulls in the Anthropic + OpenAI
 * SDKs plus the pi-* sibling packages — a cold install in a fresh E2B sandbox
 * over the network can easily exceed 3 minutes. We allow 10 minutes per
 * attempt and retry once on transient failures (E2B deadline_exceeded, npm
 * `ERR_SOCKET_TIMEOUT`, registry 5xx, etc.). When all attempts fail we
 * rethrow with a message that points the user at the underlying cause
 * instead of dumping the raw E2B error.
 */
async function installPiAgentRuntime(
  workspace: RuntimeWorkspace,
  runtimeDir: string,
  cwd: string,
): Promise<void> {
  const command = `npm install --prefix ${shellQuote(runtimeDir)} --no-audit --no-fund --prefer-offline --silent`;
  const installTimeoutMs = 600_000;
  let lastError = "";

  for (let attempt = 1; attempt <= 2; attempt++) {
    const result = await workspace.run({
      command,
      cwd,
      timeoutMs: installTimeoutMs,
      env: { CI: "true" },
    });
    if (result.exitCode === 0) return;
    lastError = result.stderr || result.stdout || `exit ${result.exitCode}`;

    const transient =
      lastError.includes("deadline_exceeded") ||
      lastError.includes("ETIMEDOUT") ||
      lastError.includes("ESOCKETTIMEDOUT") ||
      lastError.includes("ECONNRESET") ||
      lastError.includes("ERR_SOCKET_TIMEOUT") ||
      lastError.includes("registry.npmjs.org") ||
      /\b5\d{2}\b/.test(lastError);

    if (attempt < 2 && transient) {
      // Clean the (partial) node_modules so the retry starts from a known
      // state instead of inheriting half-extracted tarballs.
      await workspace.run({
        command: `rm -rf ${shellQuote(`${runtimeDir}/node_modules`)} ${shellQuote(`${runtimeDir}/package-lock.json`)}`,
        cwd,
        timeoutMs: 30_000,
      });
      continue;
    }
    break;
  }

  const isTimeout = lastError.includes("deadline_exceeded") || lastError.includes("timed out");
  throw new Error(
    isTimeout
      ? `Failed to install PI agent runtime in sandbox: npm install ran past the ${installTimeoutMs / 1000}s cap. ` +
        `This usually means the npm registry was slow or the sandbox lost network. Last error: ${lastError.slice(0, 400)}`
      : `Failed to install PI agent runtime in sandbox: ${lastError.slice(0, 600)}`,
  );
}

export function createSandboxEventParser(onEvent: (event: unknown) => void, reject: (error: Error) => void): (chunk: string) => void {
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

function runtimePiAgentScript(): string {
  return `import { readFileSync, statSync, openSync, readSync, closeSync } from "node:fs";
import path from "node:path";
import * as pi from "@mariozechner/pi-coding-agent";

const config = JSON.parse(readFileSync(new URL("./config.json", import.meta.url), "utf8"));
function emit(event) { process.stdout.write("PILAB_EVENT " + JSON.stringify({ event }) + "\\n"); }

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) throw new Error("OPENROUTER_API_KEY is required");

const agentDir = path.join(config.workspacePath, ".pilab-agent");
const authStorage = pi.AuthStorage.create(path.join(agentDir, "auth.json"));
authStorage.setRuntimeApiKey(config.provider, apiKey);
const modelRegistry = pi.ModelRegistry.create(authStorage);
const modelNames = config.modelName.includes("/")
  ? [config.modelName, config.modelName.slice(config.modelName.indexOf("/") + 1)]
  : [config.modelName];
let model = modelNames.map((name) => modelRegistry.find(config.provider, name)).find(Boolean);
if (!model) {
  // Model not in the SDK's built-in registry — register it dynamically.
  // When supplying \`models\`, the provider config requires baseUrl/apiKey/api too.
  modelRegistry.registerProvider(config.provider, {
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    apiKey: "OPENROUTER_API_KEY",
    api: "openai-completions",
    authHeader: true,
    models: [{
      id: config.modelName,
      name: config.modelName,
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 8192,
    }],
  });
  model = modelRegistry.find(config.provider, config.modelName);
}
if (!model) throw new Error(\`Pi model not found for provider \${config.provider}: \${config.modelName}\`);

const settingsManager = pi.SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: true, maxRetries: 1 } });
const resourceLoader = new pi.DefaultResourceLoader({ cwd: config.workspacePath, agentDir, settingsManager, systemPromptOverride: () => config.systemPrompt });
await resourceLoader.reload();
const { session } = await pi.createAgentSession({
  cwd: config.workspacePath,
  agentDir,
  model,
  thinkingLevel: "off",
  authStorage,
  modelRegistry,
  tools: config.tools,
  resourceLoader,
  sessionManager: pi.SessionManager.inMemory(config.workspacePath),
  settingsManager,
});
const unsubscribe = session.subscribe((event) => emit(event));

function emitTurnComplete(turn, status, message) {
  emit({ type: "pilab_turn_complete", turn, status, message });
}

let turn = 0;
let done = false;

async function runPrompt(text) {
  turn++;
  try {
    await session.prompt(text);
    emitTurnComplete(turn, "ok");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emitTurnComplete(turn, "error", message);
  }
}

try {
  await runPrompt(config.prompt);

  if (config.followUpInboxPath) {
    let cursor = 0;
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    while (!done) {
      let size = 0;
      try { size = statSync(config.followUpInboxPath).size; } catch { size = 0; }
      if (size > cursor) {
        const fd = openSync(config.followUpInboxPath, "r");
        try {
          const length = size - cursor;
          const buf = Buffer.alloc(length);
          readSync(fd, buf, 0, length, cursor);
          cursor = size;
          const chunk = buf.toString("utf8");
          const lines = chunk.split("\\n").filter((l) => l.trim().length > 0);
          for (const line of lines) {
            let parsed = null;
            try { parsed = JSON.parse(line); } catch { /* skip malformed line */ }
            if (!parsed) continue;
            if (parsed.done === true) { done = true; break; }
            if (typeof parsed.text === "string" && parsed.text.length > 0) {
              await runPrompt(parsed.text);
            }
          }
        } finally {
          closeSync(fd);
        }
      }
      if (!done) await sleep(1000);
    }
  }
} finally {
  unsubscribe();
  session.dispose();
}
`;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, signal: AbortSignal): Promise<T> {
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
