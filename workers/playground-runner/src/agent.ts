import { createBenchmarkRuntime, runSandboxPiAgent, type RuntimeProvider, type RuntimeWorkspace } from "@pilab/runtime";

const SETUP_PYTHON_SCRIPT = `
set -euo pipefail
# Install python3 + pip if not already present
command -v python3 >/dev/null 2>&1 || { apt-get update -qq && apt-get install -y -qq python3 python3-pip; }
# Common web frameworks
pip3 install --quiet flask fastapi uvicorn 2>/dev/null || true
pip3 install --quiet requests 2>/dev/null || true
echo "PYTHON_SETUP_DONE"
`;

const PLAYGROUND_TOOLS = ["read", "write", "edit", "grep", "find", "ls", "bash"];

const PLAYGROUND_ROOT = "/home/user/playground";
const BASE_PORT = 30000;

function sanitizeTools(tools: string[] | undefined): string[] {
  if (!tools || tools.length === 0) return PLAYGROUND_TOOLS;
  const filtered = tools.filter((t) => PLAYGROUND_TOOLS.includes(t) || t === "network");
  return filtered.length > 0 ? filtered : PLAYGROUND_TOOLS;
}

export type AgentRunSpec = {
  agentRunId: string;
  modelId: string;
  modelName: string;
};

export type AgentRunResult = {
  agentRunId: string;
  status: "succeeded" | "failed" | "timed_out";
  appUrl: string | null;
  output: string;
  errorMessage?: string;
};

type AppendEventBody = {
  agentRunId: string;
  seq: number;
  kind:
    | "status"
    | "assistant_text_delta"
    | "tool_call_started"
    | "tool_call_delta"
    | "tool_call_finished"
    | "port_open"
    | "url_resolved"
    | "error";
  payload?: Record<string, unknown>;
};

type RunUpdateBody = {
  status?: "queued" | "preparing" | "running" | "succeeded" | "failed";
  sandboxId?: string;
  appUrl?: string;
  output?: string;
  startedAt?: string;
  finishedAt?: string;
};

// ── Session orchestrator ────────────────────────────────────────────────────

export async function runPlaygroundSession(input: {
  apiBaseUrl: string;
  sessionId: string;
  prompt: string;
  agentRuns: AgentRunSpec[];
  apiKey: string;
  maxWallClockSeconds: number;
  /** How long to keep the sandbox alive after agents finish, awaiting a release signal. */
  maxReviewSeconds: number;
  signal: AbortSignal;
  /** Resolves when the API publishes a release signal for this session, or on internal timeout. */
  waitForRelease(sessionId: string, timeoutMs: number): Promise<void>;
  /** Hook for the worker to register a per-agent AbortController so cancel-run signals can hit it. */
  registerAgentSignal?: (agentRunId: string, abort: () => void) => () => void;
  tools?: string[];
  seedPromptText?: string;
  sandboxImage?: string;
}): Promise<{ sandboxId: string | null; agentResults: AgentRunResult[] }> {
  const {
    apiBaseUrl,
    sessionId,
    prompt,
    agentRuns,
    apiKey,
    maxWallClockSeconds,
    maxReviewSeconds,
    signal,
    waitForRelease,
    registerAgentSignal,
    tools,
    seedPromptText,
    sandboxImage,
  } = input;

  const allowedTools = sanitizeTools(tools);
  if (sandboxImage && sandboxImage !== "py-node") {
    console.log(
      `[playground-runner] session ${sessionId.slice(0, 8)} requested sandbox image "${sandboxImage}" — only py-node is wired up; using default.`,
    );
  }

  let sandbox: RuntimeWorkspace | null = null;
  const peerNames = agentRuns.map((a) => a.modelName);

  try {
    const runtime: RuntimeProvider = createBenchmarkRuntime();
    sandbox = await runtime.createWorkspace({
      id: `playground-${sessionId.slice(0, 8)}`,
      // Sandbox needs to outlive the agent loop so the human can review live URLs.
      // Allocate agents time + review window + a small slack.
      timeoutMs: (maxWallClockSeconds + maxReviewSeconds + 60) * 1000,
    });

    const sandboxId = sandbox.id;
    console.log(`[playground-runner] session ${sessionId.slice(0, 8)} sandbox=${sandboxId} agents=${agentRuns.length}`);

    // Broadcast initial status to every agent.
    await Promise.all(
      agentRuns.map(async (spec) => {
        await postRunUpdate({ apiBaseUrl, sessionId, agentRunId: spec.agentRunId }, {
          status: "preparing",
          sandboxId,
          startedAt: new Date().toISOString(),
        });
        await postEvent({ apiBaseUrl, sessionId, agentRunId: spec.agentRunId }, { kind: "status", payload: { status: "preparing", sandboxId } }, 1);
      }),
    );

    // Set up Python once for the entire session.
    const installResult = await sandbox.run({ command: SETUP_PYTHON_SCRIPT, timeoutMs: 120_000 });
    if (installResult.exitCode !== 0) {
      throw new Error(`Python setup failed: ${installResult.stderr || installResult.stdout}`);
    }

    // Bootstrap a shared git repo, then add one worktree per agent on its own branch.
    const bootstrap = await sandbox.run({
      command: [
        `mkdir -p ${PLAYGROUND_ROOT}`,
        `cd ${PLAYGROUND_ROOT}`,
        `git init -q`,
        `git config user.email playground@pilab`,
        `git config user.name playground`,
        `echo "# playground session ${sessionId}" > README.md`,
        `git add README.md`,
        `git commit -q -m init`,
      ].join(" && "),
      timeoutMs: 30_000,
    });
    if (bootstrap.exitCode !== 0) {
      throw new Error(`Git bootstrap failed: ${bootstrap.stderr || bootstrap.stdout}`);
    }

    const worktreePlans = agentRuns.map((spec, index) => {
      const branch = `agent-${index}`;
      const worktreePath = `${PLAYGROUND_ROOT}/${branch}`;
      const assignedPort = BASE_PORT + index;
      const appUrl = sandbox!.getHost(assignedPort);
      return { spec, index, branch, worktreePath, assignedPort, appUrl };
    });

    for (const plan of worktreePlans) {
      const wt = await sandbox.run({
        command: `git -C ${PLAYGROUND_ROOT} worktree add -q -b ${plan.branch} ${plan.worktreePath} HEAD`,
        timeoutMs: 30_000,
      });
      if (wt.exitCode !== 0) {
        throw new Error(`worktree add for ${plan.branch} failed: ${wt.stderr || wt.stdout}`);
      }

      // If the user supplied a seed prompt, drop it into each worktree as SEED.md
      // before the agent starts so its first read pass picks it up.
      if (seedPromptText && seedPromptText.trim().length > 0) {
        const encoded = Buffer.from(seedPromptText, "utf8").toString("base64");
        const seed = await sandbox.run({
          command: `echo '${encoded}' | base64 -d > ${plan.worktreePath}/SEED.md`,
          timeoutMs: 15_000,
        });
        if (seed.exitCode !== 0) {
          console.warn(
            `[playground-runner] failed to write SEED.md for ${plan.branch}: ${seed.stderr || seed.stdout}`,
          );
        }
      }
    }

    // Run all agents in parallel.
    const results = await Promise.all(
      worktreePlans.map((plan) =>
        runPlaygroundAgent({
          apiBaseUrl,
          sessionId,
          sandbox: sandbox!,
          prompt,
          spec: plan.spec,
          index: plan.index,
          totalAgents: agentRuns.length,
          peers: peerNames.filter((_, i) => i !== plan.index),
          worktreePath: plan.worktreePath,
          branch: plan.branch,
          assignedPort: plan.assignedPort,
          appUrl: plan.appUrl,
          apiKey,
          maxWallClockSeconds,
          signal,
          tools: allowedTools,
          hasSeed: Boolean(seedPromptText && seedPromptText.trim().length > 0),
          ...(registerAgentSignal ? { registerAgentSignal } : {}),
        }).catch((err): AgentRunResult => ({
          agentRunId: plan.spec.agentRunId,
          status: "failed",
          appUrl: null,
          output: "",
          errorMessage: err instanceof Error ? err.message : String(err),
        })),
      ),
    );

    // Keep the sandbox alive so the human can poke around the agents' apps via the
    // resolved URLs. Either the frontend signals release (button / score submit) or
    // we time out after maxReviewSeconds.
    console.log(`[playground-runner] session ${sessionId.slice(0, 8)} agents finished — holding sandbox for review (max ${maxReviewSeconds}s)`);
    await waitForRelease(sessionId, maxReviewSeconds * 1000);

    return { sandboxId, agentResults: results };
  } finally {
    if (sandbox) {
      console.log(`[playground-runner] session ${sessionId.slice(0, 8)} tearing down sandbox ${sandbox.id}`);
      await sandbox.delete().catch(() => undefined);
    }
  }
}

// ── Per-agent helper ────────────────────────────────────────────────────────

async function runPlaygroundAgent(input: {
  apiBaseUrl: string;
  sessionId: string;
  sandbox: RuntimeWorkspace;
  prompt: string;
  spec: AgentRunSpec;
  index: number;
  totalAgents: number;
  peers: string[];
  worktreePath: string;
  branch: string;
  assignedPort: number;
  appUrl: string;
  apiKey: string;
  maxWallClockSeconds: number;
  signal: AbortSignal;
  tools: string[];
  hasSeed: boolean;
  registerAgentSignal?: (agentRunId: string, abort: () => void) => () => void;
}): Promise<AgentRunResult> {
  const {
    apiBaseUrl, sessionId, sandbox, prompt,
    spec, index, totalAgents, peers,
    worktreePath, branch, assignedPort, appUrl,
    apiKey, maxWallClockSeconds, signal,
    tools, hasSeed, registerAgentSignal,
  } = input;

  const ctx = { apiBaseUrl, sessionId, agentRunId: spec.agentRunId };
  let seq = 1;
  const nextSeq = () => ++seq;
  const textChunks: string[] = [];

  // Local AbortController chained off the session signal so cancel-run can target one agent.
  const localController = new AbortController();
  const abortLocal = () => localController.abort();
  signal.addEventListener("abort", abortLocal, { once: true });
  const unregister = registerAgentSignal?.(spec.agentRunId, abortLocal) ?? (() => undefined);

  const event = async (kind: AppendEventBody["kind"], payload: Record<string, unknown>) => {
    await postEvent(ctx, { kind, payload }, nextSeq());
  };

  try {
    await event("status", {
      status: "running",
      worktreePath,
      branch,
      assignedPort,
      appUrl,
    });
    await postRunUpdate(ctx, { status: "running" });

    const systemPrompt = buildSystemPrompt({
      modelName: spec.modelName,
      agentIndex: index,
      totalAgents,
      peers,
      worktreePath,
      branch,
      assignedPort,
      appUrl,
      hasSeed,
    });

    await runSandboxPiAgent({
      workspace: sandbox,
      runId: spec.agentRunId,
      provider: "openrouter",
      // Pass the full OpenRouter slashed id (e.g. "x-ai/grok-4"). The sandbox script
      // tries the built-in registry first and dynamically registers the model otherwise.
      modelName: spec.modelId,
      prompt,
      systemPrompt,
      apiKey,
      tools,
      timeoutMs: maxWallClockSeconds * 1000,
      signal: localController.signal,
      cwd: worktreePath,
      onEvent: (sdkEvent: unknown) => {
        const mapped = mapPiSdkEventToPlayground(sdkEvent);
        if (!mapped) return;
        if (mapped.textDelta) textChunks.push(mapped.textDelta);
        void postEvent(ctx, { kind: mapped.kind, payload: mapped.payload }, nextSeq());
      },
    });

    // Is the agent's assigned port now listening?
    await event("status", { status: "resolving_url" });
    const portCheck = await sandbox.run({
      command: `ss -tlnp 2>/dev/null | awk 'NR>1 {print $4}' | sed 's/.*://' | sort -u || true`,
      timeoutMs: 5_000,
    });
    const openPorts = new Set(
      portCheck.stdout
        .split("\n")
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isInteger(n) && n > 1024 && n < 65535),
    );
    const resolvedUrl = openPorts.has(assignedPort) ? appUrl : null;
    if (resolvedUrl) {
      await event("port_open", { port: assignedPort });
      await event("url_resolved", { url: resolvedUrl });
    }

    const output = textChunks.join("");

    await postRunUpdate(ctx, {
      status: "succeeded",
      output,
      ...(resolvedUrl ? { appUrl: resolvedUrl } : {}),
      finishedAt: new Date().toISOString(),
    });

    return { agentRunId: spec.agentRunId, status: "succeeded", appUrl: resolvedUrl, output };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    await event("error", { error: errorMessage });
    const output = textChunks.join("");
    await postRunUpdate(ctx, {
      status: "failed",
      output,
      finishedAt: new Date().toISOString(),
    });
    const cancelled = localController.signal.aborted && !signal.aborted;
    return {
      agentRunId: spec.agentRunId,
      status: cancelled ? "failed" : signal.aborted ? "timed_out" : "failed",
      appUrl: null,
      output,
      errorMessage: cancelled ? "cancelled_by_user" : errorMessage,
    };
  } finally {
    signal.removeEventListener("abort", abortLocal);
    unregister();
  }
}

// ── System prompt builder ───────────────────────────────────────────────────

function buildSystemPrompt(env: {
  modelName: string;
  agentIndex: number;
  totalAgents: number;
  peers: string[];
  worktreePath: string;
  branch: string;
  assignedPort: number;
  appUrl: string;
  hasSeed?: boolean;
}): string {
  const peerLine = env.peers.length > 0
    ? `Competing agents in this session: ${env.peers.join(", ")}.`
    : `You are the only agent in this session.`;
  const seedLine = env.hasSeed
    ? `\nThere is a SEED.md file in your working directory that contains starter context for this task. Read it first before doing anything else.\n`
    : "";

  return [
    `You are agent ${env.agentIndex + 1} of ${env.totalAgents} (${env.modelName}) in a head-to-head playground session. ${peerLine}`,
    seedLine,
    `# Environment`,
    `You are running inside a shared E2B Linux sandbox with Python 3 and Node.js available. You share this sandbox with the other agents above.`,
    ``,
    `- Your working directory: ${env.worktreePath} (git branch \`${env.branch}\`)`,
    `- Only read, write, edit, or \`cd\` inside this directory. Do NOT touch any path outside it — those belong to other agents.`,
    `- Your assigned port: ${env.assignedPort}. If your task involves a web server, bind to **0.0.0.0:${env.assignedPort}** exclusively. Other agents have different ports.`,
    `- Your app's public URL when listening on that port: ${env.appUrl}`,
    ``,
    `# Tools`,
    `You have tools to read, write, and edit files, and to run bash commands. Stay inside ${env.worktreePath}.`,
    ``,
    `# Goals`,
    `- Build a complete, working application that satisfies the user's prompt.`,
    `- Prefer a small set of files in a single directory. Use whatever stack fits the task.`,
    `- If you start a web server, bind to **0.0.0.0:${env.assignedPort}** and leave it running so the human grader can open ${env.appUrl}.`,
    `- Verify your work briefly (curl, --help, smoke tests) before finishing.`,
    `- When you are done, write a final message starting with **"FINAL:"** that summarizes what you built, how to run it, and (if it's a server) includes the public URL ${env.appUrl}.`,
  ].join("\n");
}

// ── API helpers (shared by orchestrator + per-agent code) ───────────────────

type ApiCtx = { apiBaseUrl: string; sessionId: string; agentRunId: string };

async function postEvent(
  ctx: ApiCtx,
  { kind, payload }: { kind: AppendEventBody["kind"]; payload: Record<string, unknown> },
  seq: number,
) {
  const body: AppendEventBody = { agentRunId: ctx.agentRunId, seq, kind, payload };
  try {
    const res = await fetch(`${ctx.apiBaseUrl}/playground/${ctx.sessionId}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error(`[playground-runner] event POST failed (${res.status}): ${await res.text()}`);
    }
  } catch (err) {
    console.error(`[playground-runner] event POST error:`, err);
  }
}

async function postRunUpdate(ctx: ApiCtx, body: RunUpdateBody) {
  try {
    const res = await fetch(`${ctx.apiBaseUrl}/playground/${ctx.sessionId}/runs/${ctx.agentRunId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error(`[playground-runner] run update failed (${res.status}): ${await res.text()}`);
    }
  } catch (err) {
    console.error(`[playground-runner] run update error:`, err);
  }
}

// ── Pi SDK → playground event mapping ───────────────────────────────────────

type MappedEvent = {
  kind: AppendEventBody["kind"];
  payload: Record<string, unknown>;
  textDelta?: string;
};

function mapPiSdkEventToPlayground(event: unknown): MappedEvent | null {
  if (!isRecord(event)) return null;
  const type = stringValue(event.type);

  if (type === "message_update" && isRecord(event.assistantMessageEvent)) {
    const inner = event.assistantMessageEvent;
    const innerType = stringValue(inner.type);

    if (innerType === "text_delta") {
      const delta = stringValue(inner.delta) ?? "";
      if (!delta) return null;
      return { kind: "assistant_text_delta", payload: { delta }, textDelta: delta };
    }
    return null;
  }

  if (type === "tool_execution_start") {
    return {
      kind: "tool_call_started",
      payload: scrub({
        toolName: stringValue(event.toolName) ?? "unknown",
        toolCallId: stringValue(event.toolCallId),
        arguments: event.args ?? event.arguments,
      }),
    };
  }
  if (type === "tool_execution_update") {
    return {
      kind: "tool_call_delta",
      payload: scrub({
        toolName: stringValue(event.toolName),
        toolCallId: stringValue(event.toolCallId),
        partialResult: event.partialResult,
      }),
    };
  }
  if (type === "tool_execution_end") {
    return {
      kind: "tool_call_finished",
      payload: scrub({
        toolName: stringValue(event.toolName) ?? "unknown",
        toolCallId: stringValue(event.toolCallId),
        result: event.result,
        isError: Boolean(event.isError),
      }),
    };
  }

  // Drop every other lifecycle event (agent_*, turn_*, message_start/end,
  // queue_update, compaction_*, auto_retry_*, session_info_changed, etc.).
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function scrub(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}
