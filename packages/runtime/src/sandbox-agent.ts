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
}): Promise<void> {
  const cwd = input.cwd ?? input.workspace.rootPath;
  const runtimeDir = `${cwd}/.pilab-agent-runtime`;
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
    }),
  });
  await input.workspace.writeFile({
    path: `${runtimeDir}/run-pi-agent.mjs`,
    content: runtimePiAgentScript(),
  });

  const install = await input.workspace.run({
    command: `npm install --prefix ${shellQuote(runtimeDir)} --no-audit --no-fund --silent`,
    cwd,
    timeoutMs: 180_000,
    env: { CI: "true" },
  });
  if (install.exitCode !== 0) {
    throw new Error(`Failed to install PI agent runtime in sandbox: ${install.stderr || install.stdout}`);
  }

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
  return `import { readFileSync } from "node:fs";
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
try { await session.prompt(config.prompt); } finally { unsubscribe(); session.dispose(); }
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
