import {
  addWorktree,
  bootstrapSharedRepo,
  buildPeerSystemPrompt,
  createBenchmarkRuntime,
  createEventStream,
  createFollowUpInbox,
  isTurnCompleteEvent,
  mapPiSdkEvent,
  runSandboxPiAgent,
  writeSeedFile,
  type AgentInbox,
  type AppendEventBody,
  type EventStream,
  type RuntimeProvider,
  type RuntimeWorkspace,
  type RunUpdateBody,
} from "@pilab/runtime";

export type { AgentInbox } from "@pilab/runtime";

type AgentHandle = {
  result: AgentRunResult;
  inbox: AgentInbox;
  scriptDone: Promise<void>;
};

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

const PLAYGROUND_EVENTS_PATH = "/playground/:sessionId/events";
const PLAYGROUND_RUN_UPDATE_PATH = "/playground/:sessionId/runs/:agentRunId";

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

async function pollForListeningPort(
  sandbox: RuntimeWorkspace,
  port: number,
  appUrl: string,
): Promise<string | null> {
  // Roughly 15 seconds: 8 attempts with 2 s gap. Each command is fast so the
  // wall-clock cost is mostly idle wait, which is also when the user is
  // staring at the live grid waiting for the iframe to be useful.
  const attempts = 8;
  const intervalMs = 2_000;
  // Prefer `ss` because it works on every modern Linux base image; fall back
  // to `netstat` (busybox) or to `/proc/net/tcp` parsing if neither is
  // installed. We ask for any of them in one composite command so we only
  // round-trip once per poll.
  const probe = [
    `(ss -tln 2>/dev/null | awk 'NR>1 {print $4}'`,
    `|| netstat -tln 2>/dev/null | awk 'NR>2 {print $4}'`,
    `|| awk '/:/{print $2}' /proc/net/tcp /proc/net/tcp6 2>/dev/null | awk -F: '{print strtonum("0x"$2)}')`,
    `| sed 's/.*://' | sort -u`,
  ].join(" ");

  for (let attempt = 0; attempt < attempts; attempt++) {
    const res = await sandbox.run({ command: probe, timeoutMs: 5_000 });
    const open = res.stdout
      .split("\n")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n > 1024 && n < 65535);
    if (open.includes(port)) return appUrl;
    if (attempt < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
  return null;
}

async function snapshotWorktreeStats(
  sandbox: RuntimeWorkspace,
  worktreePath: string,
): Promise<{ fileCount: number | null; loc: number | null }> {
  try {
    const fileCountRes = await sandbox.run({
      command: `find ${worktreePath} -type f -not -path '*/.*' -not -path '*/node_modules/*' | wc -l`,
      timeoutMs: 5_000,
    });
    const fileCount = Number.parseInt(fileCountRes.stdout.trim(), 10);
    const locRes = await sandbox.run({
      command: `find ${worktreePath} -type f \\( -name '*.py' -o -name '*.js' -o -name '*.ts' -o -name '*.tsx' -o -name '*.jsx' -o -name '*.html' -o -name '*.css' -o -name '*.sh' -o -name '*.md' \\) -not -path '*/.*' -not -path '*/node_modules/*' -print0 2>/dev/null | xargs -0 wc -l 2>/dev/null | tail -n 1 | awk '{print $1}'`,
      timeoutMs: 5_000,
    });
    const loc = Number.parseInt(locRes.stdout.trim(), 10);
    return {
      fileCount: Number.isFinite(fileCount) ? fileCount : null,
      loc: Number.isFinite(loc) ? loc : null,
    };
  } catch {
    return { fileCount: null, loc: null };
  }
}

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
  /** Hook for the worker to register a follow-up inbox per agent. The worker
   *  invokes `appendFollowUp` when a user sends a new turn over Redis. */
  registerFollowUpInbox?: (agentRunId: string, inbox: AgentInbox) => () => void;
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
    registerFollowUpInbox,
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

    // One EventStream per agent — shared between initial broadcast and per-agent loop
    // so the seq counter stays monotonic for downstream consumers.
    const streams = new Map<string, EventStream>(
      agentRuns.map((spec) => [
        spec.agentRunId,
        createEventStream({
          apiBaseUrl,
          eventsPath: PLAYGROUND_EVENTS_PATH,
          runUpdatePath: PLAYGROUND_RUN_UPDATE_PATH,
          sessionId,
          agentRunId: spec.agentRunId,
          loggerTag: "playground-runner",
        }),
      ]),
    );
    // Broadcast initial status to every agent.
    await Promise.all(
      agentRuns.map(async (spec) => {
        const stream = streams.get(spec.agentRunId)!;
        await stream.postRunUpdate({
          status: "preparing",
          sandboxId,
          startedAt: new Date().toISOString(),
        });
        await stream.postEvent("status", { status: "preparing", sandboxId });
      }),
    );

    // Set up Python once for the entire session.
    const installResult = await sandbox.run({ command: SETUP_PYTHON_SCRIPT, timeoutMs: 120_000 });
    if (installResult.exitCode !== 0) {
      throw new Error(`Python setup failed: ${installResult.stderr || installResult.stdout}`);
    }

    // Bootstrap a shared git repo, then add one worktree per agent on its own branch.
    await bootstrapSharedRepo({
      workspace: sandbox,
      root: PLAYGROUND_ROOT,
      description: `playground session ${sessionId}`,
      userEmail: "playground@pilab",
      userName: "playground",
    });

    const worktreePlans = agentRuns.map((spec, index) => {
      const branch = `agent-${index}`;
      const worktreePath = `${PLAYGROUND_ROOT}/${branch}`;
      const assignedPort = BASE_PORT + index;
      const appUrl = sandbox!.getHost(assignedPort);
      return { spec, index, branch, worktreePath, assignedPort, appUrl };
    });

    for (const plan of worktreePlans) {
      await addWorktree({
        workspace: sandbox,
        root: PLAYGROUND_ROOT,
        branch: plan.branch,
        worktreePath: plan.worktreePath,
      });

      // If the user supplied a seed prompt, drop it into each worktree as SEED.md
      // before the agent starts so its first read pass picks it up.
      if (seedPromptText && seedPromptText.trim().length > 0) {
        try {
          await writeSeedFile({
            workspace: sandbox,
            worktreePath: plan.worktreePath,
            seedText: seedPromptText,
          });
        } catch (err) {
          console.warn(
            `[playground-runner] failed to write SEED.md for ${plan.branch}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }

    // Kick off every agent in parallel. Each returns a handle: { result, inbox,
    // scriptDone }. We wait for the first turn (`result`) before holding for
    // review; the underlying script stays alive in the sandbox so the worker
    // can pipe follow-up turns into the agent's inbox file.
    const handles = await Promise.all(
      worktreePlans.map((plan) =>
        runPlaygroundAgent({
          stream: streams.get(plan.spec.agentRunId)!,
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
        }).catch((err): AgentHandle => ({
          result: {
            agentRunId: plan.spec.agentRunId,
            status: "failed",
            appUrl: null,
            output: "",
            errorMessage: err instanceof Error ? err.message : String(err),
          },
          inbox: { appendFollowUp: async () => undefined, sendDone: async () => undefined },
          scriptDone: Promise.resolve(),
        })),
      ),
    );

    const results = handles.map((h) => h.result);

    // Register each agent's inbox with the worker so external follow-up
    // pub/sub events can flow into it.
    const unregisterInboxes: Array<() => void> = [];
    if (registerFollowUpInbox) {
      for (let i = 0; i < worktreePlans.length; i++) {
        const plan = worktreePlans[i]!;
        const handle = handles[i]!;
        unregisterInboxes.push(registerFollowUpInbox(plan.spec.agentRunId, handle.inbox));
      }
    }

    // Keep the sandbox alive so the human can poke around the agents' apps and
    // send follow-up turns. Either the frontend signals release (button /
    // score submit) or we time out after maxReviewSeconds.
    console.log(`[playground-runner] session ${sessionId.slice(0, 8)} first turns finished — holding sandbox for review (max ${maxReviewSeconds}s)`);
    await waitForRelease(sessionId, maxReviewSeconds * 1000);

    // Tell every script to exit cleanly, then wait for them (with a short
    // timeout so a misbehaving script can't block the sandbox tear-down).
    for (const handle of handles) {
      await handle.inbox.sendDone().catch(() => undefined);
    }
    await Promise.race([
      Promise.allSettled(handles.map((h) => h.scriptDone)),
      new Promise<void>((resolve) => setTimeout(resolve, 30_000)),
    ]);

    for (const unreg of unregisterInboxes) unreg();

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
  stream: EventStream;
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
}): Promise<AgentHandle> {
  const {
    stream, sandbox, prompt,
    spec, index, totalAgents, peers,
    worktreePath, branch, assignedPort, appUrl,
    apiKey, maxWallClockSeconds, signal,
    tools, hasSeed, registerAgentSignal,
  } = input;

  const textChunks: string[] = [];
  const followUpInboxPath = `${worktreePath}/.pilab-followups.jsonl`;
  const inbox = createFollowUpInbox({ workspace: sandbox, inboxPath: followUpInboxPath });

  // Local AbortController chained off the session signal so cancel-run can target one agent.
  const localController = new AbortController();
  const abortLocal = () => localController.abort();
  signal.addEventListener("abort", abortLocal, { once: true });
  const unregister = registerAgentSignal?.(spec.agentRunId, abortLocal) ?? (() => undefined);

  const event = (kind: AppendEventBody["kind"], payload: Record<string, unknown>) =>
    stream.postEvent(kind, payload);

  let firstTurnResolve!: (value: AgentRunResult) => void;
  let firstTurnReject!: (err: Error) => void;
  const firstTurnPromise = new Promise<AgentRunResult>((resolve, reject) => {
    firstTurnResolve = resolve;
    firstTurnReject = reject;
  });
  let firstTurnDone = false;
  let turnInFlight: Promise<void> = Promise.resolve();

  // Handler called whenever the script emits a `pilab_turn_complete` event.
  // Re-polls for a listening port + snapshots the worktree, posts a run update.
  async function handleTurnComplete(turn: number) {
    try {
      const resolvedUrl = await pollForListeningPort(sandbox, assignedPort, appUrl);
      if (resolvedUrl) {
        await event("port_open", { port: assignedPort });
        await event("url_resolved", { url: resolvedUrl });
      }
      const stats = await snapshotWorktreeStats(sandbox, worktreePath);
      await event("turn_complete", { turn });
      const output = textChunks.join("");
      const update: RunUpdateBody = {
        status: "succeeded",
        output,
        finishedAt: new Date().toISOString(),
      };
      if (resolvedUrl) update.appUrl = resolvedUrl;
      if (stats.fileCount != null) update.fileCount = stats.fileCount;
      if (stats.loc != null) update.loc = stats.loc;
      await stream.postRunUpdate(update);
      if (!firstTurnDone) {
        firstTurnDone = true;
        firstTurnResolve({
          agentRunId: spec.agentRunId,
          status: "succeeded",
          appUrl: resolvedUrl,
          output,
        });
      }
    } catch (err) {
      console.error(`[playground-runner] handleTurnComplete error for ${spec.agentRunId.slice(0, 8)}:`, err);
    }
  }

  try {
    await event("status", {
      status: "running",
      worktreePath,
      branch,
      assignedPort,
      appUrl,
    });
    await stream.postRunUpdate({ status: "running" });

    const systemPrompt = buildPeerSystemPrompt({
      role: "playground_agent",
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

    // Kick off the long-running script. Don't await; we resolve from the
    // first `pilab_turn_complete` event instead.
    const scriptDone = runSandboxPiAgent({
      workspace: sandbox,
      runId: spec.agentRunId,
      provider: "openrouter",
      modelName: spec.modelId,
      prompt,
      systemPrompt,
      apiKey,
      tools,
      timeoutMs: maxWallClockSeconds * 1000,
      signal: localController.signal,
      cwd: worktreePath,
      followUpInboxPath,
      onEvent: (sdkEvent: unknown) => {
        if (isTurnCompleteEvent(sdkEvent)) {
          const turn = typeof sdkEvent.turn === "number" ? sdkEvent.turn : 1;
          turnInFlight = turnInFlight.then(() => handleTurnComplete(turn));
          return;
        }
        const mapped = mapPiSdkEvent(sdkEvent);
        if (!mapped) return;
        if (mapped.textDelta) textChunks.push(mapped.textDelta);
        void stream.postEvent(mapped.kind, mapped.payload);
      },
    }).catch(async (err: unknown) => {
      const errorMessage = err instanceof Error ? err.message : String(err);
      if (!firstTurnDone) {
        // Make sure the playground transcript records the failure even when
        // it happens before the first turn ever completes.
        try {
          await event("error", { error: errorMessage });
          const output = textChunks.join("");
          await stream.postRunUpdate({ status: "failed", output, finishedAt: new Date().toISOString() });
        } finally {
          firstTurnDone = true;
          const cancelled = localController.signal.aborted && !signal.aborted;
          firstTurnReject(new Error(cancelled ? "cancelled_by_user" : errorMessage));
        }
      } else {
        console.warn(`[playground-runner] script for ${spec.agentRunId.slice(0, 8)} exited after first turn: ${errorMessage}`);
      }
    });

    // Make sure listeners on `scriptDone` resolve cleanly even if the catch
    // above swallows an error after the first turn.
    const scriptDoneCleaned = scriptDone.then(
      () => undefined,
      () => undefined,
    );

    const result = await firstTurnPromise.catch((err: unknown): AgentRunResult => ({
      agentRunId: spec.agentRunId,
      status: "failed",
      appUrl: null,
      output: textChunks.join(""),
      errorMessage: err instanceof Error ? err.message : String(err),
    }));

    return {
      result,
      inbox,
      scriptDone: scriptDoneCleaned.finally(() => {
        signal.removeEventListener("abort", abortLocal);
        unregister();
      }),
    };
  } catch (err) {
    signal.removeEventListener("abort", abortLocal);
    unregister();
    const errorMessage = err instanceof Error ? err.message : String(err);
    const output = textChunks.join("");
    try { await event("error", { error: errorMessage }); } catch { /* ignore */ }
    try {
      await stream.postRunUpdate({ status: "failed", output, finishedAt: new Date().toISOString() });
    } catch { /* ignore */ }
    return {
      result: {
        agentRunId: spec.agentRunId,
        status: "failed",
        appUrl: null,
        output,
        errorMessage,
      },
      inbox,
      scriptDone: Promise.resolve(),
    };
  }
}
