import { eq, inArray } from "drizzle-orm";
import type { Job } from "bullmq";
import type { DbClient } from "@pilab/db";
import {
  artifacts,
  caseVersions,
  evaluations,
  experiments,
  githubIssues,
  patches,
  planScores,
  plans,
  runs,
  testSpecs,
} from "@pilab/db/schema";
import {
  addWorktree,
  createBenchmarkRuntime,
  buildPeerSystemPrompt,
  runSandboxPiAgent,
  shellQuote,
  writeSeedFile,
  type RuntimeProvider,
  type RuntimeWorkspace,
} from "@pilab/runtime";
import {
  createBenchmarkBatchProgress,
  type BenchmarkBatchAgentResult,
  type BenchmarkBatchAgentSpec,
  type BenchmarkBatchJobData,
  type BenchmarkBatchJobResult,
} from "@pilab/jobs";

import { createPiRunnerObjectStore, type PiRunnerObjectStore } from "./object-store.js";

const REPO_ROOT = "/home/user/repo";
const AGENT_TOOLS = ["read", "write", "edit", "grep", "find", "ls", "bash"];
const EVALUATOR_TOOLS = ["read", "grep", "find", "ls", "bash"];
const DEFAULT_AGENT_WALL_CLOCK = 900;
const DEFAULT_EVALUATOR_WALL_CLOCK = 600;
const DEFAULT_EVALUATOR_MODEL = "anthropic/claude-haiku-4-5";

type AgentPlan = {
  spec: BenchmarkBatchAgentSpec;
  index: number;
  branch: string;
  worktreePath: string;
};

type EvaluatorScore = {
  agentIndex: number;
  branch: string;
  overall: number;
  correctness?: number;
  codeQuality?: number;
  ux?: number;
  shipIt?: number;
  rationale?: string;
};

export type BenchmarkBatchProcessorConfig = {
  db: DbClient;
  apiKey: string;
  objectStore?: PiRunnerObjectStore;
};

/**
 * One job per (experiment × case_version). All N benchmarked agents share one
 * E2B sandbox, each in its own git worktree off the base commit. After they
 * finish their first turn we either run the validated tests against each
 * worktree (deterministic_tests strategy) or spawn a Pi-evaluator agent in
 * the same sandbox to score each worktree against the gold patch
 * (llm_evaluator_only strategy).
 */
export function createBenchmarkBatchProcessor(input: BenchmarkBatchProcessorConfig) {
  const objectStore = input.objectStore ?? createPiRunnerObjectStore();
  const { db, apiKey } = input;

  return async function processBenchmarkBatch(
    job: Job<BenchmarkBatchJobData, BenchmarkBatchJobResult>,
  ): Promise<BenchmarkBatchJobResult> {
    const { experimentId, caseVersionId, agentRuns } = job.data;
    const maxAgentWallClock = job.data.maxWallClockSeconds ?? DEFAULT_AGENT_WALL_CLOCK;
    const maxEvaluatorWallClock = job.data.maxEvaluatorSeconds ?? DEFAULT_EVALUATOR_WALL_CLOCK;
    const evaluatorModelId = job.data.evaluatorModelId ?? DEFAULT_EVALUATOR_MODEL;

    await job.updateProgress(
      createBenchmarkBatchProgress("loading-context", "Loading case + issue context"),
    );

    const ctx = await loadBatchContext(db, caseVersionId);
    if (!ctx.repoUrl || !ctx.baseCommitSha) {
      throw new Error(
        `Benchmark batch cannot run: case ${caseVersionId} is missing repoUrl or baseCommitSha`,
      );
    }
    const strategy = ctx.evaluatorStrategy ?? "llm_evaluator_only";
    const needsGold = strategy === "llm_evaluator_only";
    if (needsGold && !ctx.goldCommitSha) {
      throw new Error(
        `llm_evaluator_only case ${caseVersionId} has no goldCommitSha`,
      );
    }

    await markRuns(db, agentRuns.map((a) => a.runId), {
      status: "preparing",
      startedAt: new Date(),
    });

    await job.updateProgress(
      createBenchmarkBatchProgress("preparing-sandbox", "Creating shared sandbox + worktrees"),
    );

    const runtime: RuntimeProvider = createBenchmarkRuntime();
    const sandbox: RuntimeWorkspace = await runtime.createWorkspace({
      id: `bench-${experimentId.slice(0, 8)}-${caseVersionId.slice(0, 8)}`,
      timeoutMs: (maxAgentWallClock + maxEvaluatorWallClock + 180) * 1000,
    });

    await db
      .update(experiments)
      .set({ sandboxId: sandbox.id })
      .where(eq(experiments.id, experimentId));

    try {
      await initRepoAtBaseAndOptionallyGold({
        workspace: sandbox,
        repoUrl: ctx.repoUrl,
        baseCommit: ctx.baseCommitSha,
        goldCommit: needsGold ? ctx.goldCommitSha! : null,
      });

      const peerNames = agentRuns.map((a) => a.modelName);
      const agentPlans: AgentPlan[] = agentRuns.map((spec, index) => ({
        spec,
        index,
        branch: `agent-${index}`,
        worktreePath: `${REPO_ROOT}-agent-${index}`,
      }));

      for (const plan of agentPlans) {
        await addWorktree({
          workspace: sandbox,
          root: REPO_ROOT,
          branch: plan.branch,
          worktreePath: plan.worktreePath,
          baseRef: "base",
        });
        await writeSeedFile({
          workspace: sandbox,
          worktreePath: plan.worktreePath,
          seedText: renderIssueSeed(ctx.issueTitle, ctx.issueBody),
          fileName: "ISSUE.md",
        });
      }

      await markRuns(db, agentRuns.map((a) => a.runId), { status: "running" });
      await job.updateProgress(
        createBenchmarkBatchProgress("running-agents", `Running ${agentRuns.length} agents in parallel`),
      );

      const handles = await Promise.allSettled(
        agentPlans.map((plan) =>
          runOneAgent({
            sandbox,
            plan,
            peers: peerNames.filter((_, i) => i !== plan.index),
            apiKey,
            issueTitle: ctx.issueTitle,
            issueBody: ctx.issueBody,
            maxWallClockSeconds: plan.spec.maxWallClockSeconds ?? maxAgentWallClock,
          }),
        ),
      );

      await job.updateProgress(
        createBenchmarkBatchProgress("collecting-patches", "Collecting patches from each agent"),
      );

      const agentResults: BenchmarkBatchAgentResult[] = [];
      for (let i = 0; i < agentPlans.length; i++) {
        const plan = agentPlans[i]!;
        const handle = handles[i]!;
        agentResults.push(
          await finalizeAgentRun({
            db,
            objectStore,
            sandbox,
            plan,
            handle,
            caseVersionId,
          }),
        );
      }

      let evaluatorRunId: string | null = null;
      if (strategy === "deterministic_tests") {
        await job.updateProgress(
          createBenchmarkBatchProgress("scoring-deterministic", "Running validated tests against each worktree"),
        );
        await scoreWithDeterministicTests({
          db,
          sandbox,
          agentPlans,
          agentResults,
          caseVersionId,
        });
      } else {
        await job.updateProgress(
          createBenchmarkBatchProgress("scoring-evaluator", "Running Pi evaluator agent"),
        );
        evaluatorRunId = await scoreWithEvaluator({
          db,
          sandbox,
          experimentId,
          caseVersionId,
          agentPlans,
          agentResults,
          ctx,
          apiKey,
          evaluatorModelId,
          maxWallClockSeconds: maxEvaluatorWallClock,
        });
      }

      await job.updateProgress(
        createBenchmarkBatchProgress("completed", "Benchmark batch completed"),
      );

      // Mark the experiment finished once every queued run for it has reached
      // a terminal state. We re-query because there may be other case_version
      // batches still running for the same experiment.
      await maybeFinishExperiment(db, experimentId);

      return {
        experimentId,
        caseVersionId,
        sandboxId: sandbox.id,
        strategy,
        agentResults,
        evaluatorRunId,
        completedAt: new Date().toISOString(),
      };
    } finally {
      await sandbox.delete().catch(() => undefined);
    }
  };
}

async function maybeFinishExperiment(db: DbClient, experimentId: string): Promise<void> {
  const allRuns = await db
    .select({ status: runs.status })
    .from(runs)
    .where(eq(runs.experimentId, experimentId));
  if (allRuns.length === 0) return;
  const terminal = new Set(["succeeded", "failed", "timed_out", "cancelled"]);
  const allDone = allRuns.every((r) => terminal.has(r.status));
  if (!allDone) return;
  const anyFailed = allRuns.some((r) => r.status === "failed" || r.status === "timed_out");
  await db
    .update(experiments)
    .set({
      status: anyFailed ? "failed" : "succeeded",
      finishedAt: new Date(),
    })
    .where(eq(experiments.id, experimentId));
}

// ── Sandbox setup ───────────────────────────────────────────────────────────

async function initRepoAtBaseAndOptionallyGold(input: {
  workspace: RuntimeWorkspace;
  repoUrl: string;
  baseCommit: string;
  goldCommit: string | null;
}): Promise<void> {
  const { workspace, repoUrl, baseCommit, goldCommit } = input;
  const steps = [
    `mkdir -p ${shellQuote(REPO_ROOT)}`,
    `git init -q ${shellQuote(REPO_ROOT)}`,
    `git -C ${shellQuote(REPO_ROOT)} config user.email runner-pi@pilab`,
    `git -C ${shellQuote(REPO_ROOT)} config user.name runner-pi`,
    `git -C ${shellQuote(REPO_ROOT)} remote add origin ${shellQuote(repoUrl)} 2>/dev/null || git -C ${shellQuote(REPO_ROOT)} remote set-url origin ${shellQuote(repoUrl)}`,
    `git -C ${shellQuote(REPO_ROOT)} fetch --depth=1 origin ${shellQuote(baseCommit)}`,
    `git -C ${shellQuote(REPO_ROOT)} checkout -B base ${shellQuote(baseCommit)}`,
  ];
  if (goldCommit) {
    steps.push(
      `git -C ${shellQuote(REPO_ROOT)} fetch --depth=1 origin ${shellQuote(goldCommit)}`,
      `git -C ${shellQuote(REPO_ROOT)} branch -f gold ${shellQuote(goldCommit)}`,
    );
  }
  const result = await workspace.run({
    command: steps.join(" && "),
    timeoutMs: 300_000,
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `Failed to initialize benchmark sandbox repo: ${result.stderr || result.stdout}`,
    );
  }
}

function renderIssueSeed(title: string, body: string): string {
  return [
    `# ${title || "(no title)"}`,
    ``,
    body || "_(no body)_",
  ].join("\n");
}

// ── Per-agent execution ────────────────────────────────────────────────────

type AgentRunOutcome = {
  status: "succeeded" | "failed" | "timed_out";
  output: string;
  errorMessage?: string;
};

async function runOneAgent(input: {
  sandbox: RuntimeWorkspace;
  plan: AgentPlan;
  peers: string[];
  apiKey: string;
  issueTitle: string;
  issueBody: string;
  maxWallClockSeconds: number;
}): Promise<AgentRunOutcome> {
  const textChunks: string[] = [];
  const controller = new AbortController();

  const systemPrompt = buildPeerSystemPrompt({
    role: "benchmark_agent",
    modelName: input.plan.spec.modelName,
    agentIndex: input.plan.index,
    totalAgents: input.peers.length + 1,
    peers: input.peers,
    worktreePath: input.plan.worktreePath,
    branch: input.plan.branch,
    extra: `Read ISSUE.md in your worktree for the task description. Commit your changes locally; the orchestrator collects \`git diff base..${input.plan.branch}\` after you finish.`,
  });

  const userPrompt = [
    `Read \`ISSUE.md\` for the task to solve, then implement a fix on this branch.`,
    `Stage and commit your changes (\`git add -A && git commit -m "fix"\`) so the orchestrator can collect the diff.`,
    `When done, write a FINAL: summary listing the files you changed.`,
  ].join("\n");

  try {
    await runSandboxPiAgent({
      workspace: input.sandbox,
      runId: input.plan.spec.runId,
      provider: "openrouter",
      modelName: input.plan.spec.modelId,
      prompt: userPrompt,
      systemPrompt,
      apiKey: input.apiKey,
      tools: AGENT_TOOLS,
      timeoutMs: input.maxWallClockSeconds * 1000,
      signal: controller.signal,
      cwd: input.plan.worktreePath,
      followUpInboxPath: null,
      onEvent: (sdkEvent) => {
        const delta = extractTextDelta(sdkEvent);
        if (delta) textChunks.push(delta);
      },
    });
    return { status: "succeeded", output: textChunks.join("") };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status: AgentRunOutcome["status"] = /timed out|timeout/i.test(message)
      ? "timed_out"
      : "failed";
    return { status, output: textChunks.join(""), errorMessage: message };
  }
}

function extractTextDelta(event: unknown): string | null {
  if (typeof event !== "object" || event === null) return null;
  const e = event as Record<string, unknown>;
  if (e.type !== "message_update") return null;
  const inner = e.assistantMessageEvent;
  if (typeof inner !== "object" || inner === null) return null;
  const innerObj = inner as Record<string, unknown>;
  if (innerObj.type !== "text_delta") return null;
  return typeof innerObj.delta === "string" ? innerObj.delta : null;
}

async function finalizeAgentRun(input: {
  db: DbClient;
  objectStore: PiRunnerObjectStore;
  sandbox: RuntimeWorkspace;
  plan: AgentPlan;
  handle: PromiseSettledResult<AgentRunOutcome>;
  caseVersionId: string;
}): Promise<BenchmarkBatchAgentResult> {
  const { db, objectStore, sandbox, plan, handle, caseVersionId } = input;
  const runId = plan.spec.runId;

  const outcome: AgentRunOutcome =
    handle.status === "fulfilled"
      ? handle.value
      : {
          status: "failed",
          output: "",
          errorMessage:
            handle.reason instanceof Error
              ? handle.reason.message
              : String(handle.reason),
        };

  if (outcome.status !== "succeeded") {
    await db
      .update(runs)
      .set({
        status: outcome.status === "timed_out" ? "timed_out" : "failed",
        finishedAt: new Date(),
        error: outcome.errorMessage ? { message: outcome.errorMessage } : null,
      })
      .where(eq(runs.id, runId));
    const failResult: BenchmarkBatchAgentResult = {
      runId,
      status: outcome.status,
    };
    if (outcome.errorMessage) failResult.errorMessage = outcome.errorMessage;
    return failResult;
  }

  // Stage any uncommitted changes the agent left behind, then collect the diff.
  await sandbox.run({
    command: `git -C ${shellQuote(plan.worktreePath)} add -A && git -C ${shellQuote(plan.worktreePath)} commit -q -m "agent-${plan.index} final" --allow-empty`,
    timeoutMs: 30_000,
  });
  const diffRes = await sandbox.run({
    command: `git -C ${shellQuote(REPO_ROOT)} diff base..${shellQuote(plan.branch)}`,
    timeoutMs: 30_000,
  });
  const patchDiff = diffRes.stdout || "";
  const filesRes = await sandbox.run({
    command: `git -C ${shellQuote(REPO_ROOT)} diff --name-only base..${shellQuote(plan.branch)} | wc -l`,
    timeoutMs: 15_000,
  });
  const filesChanged = Number.parseInt(filesRes.stdout.trim(), 10) || 0;

  await objectStore.ensureBucket();
  const patchStored = await objectStore.putArtifact({
    key: `runs/${runId}/patch.diff`,
    body: patchDiff || "# No changes\n",
    contentType: "text/x-diff; charset=utf-8",
    metadata: { runId, caseVersionId, branch: plan.branch },
  });
  const [patchArtifactRow] = await db
    .insert(artifacts)
    .values({
      kind: "predicted_patch",
      storageProvider: "s3",
      bucket: patchStored.bucket,
      objectKey: patchStored.key,
      sha256: patchStored.sha256,
      byteSize: patchStored.sizeBytes,
      contentType: patchStored.contentType,
      metadata: { runId, caseVersionId, branch: plan.branch },
    })
    .returning();
  if (!patchArtifactRow) {
    throw new Error(`Failed to persist patch artifact for run ${runId}`);
  }

  await db.insert(patches).values({
    runId,
    caseVersionId,
    artifactId: patchArtifactRow.id,
    kind: "predicted",
    summary: `Patch from agent ${plan.spec.modelName}`,
    stats: { filesChanged },
  });

  await db
    .update(runs)
    .set({ status: "succeeded", finishedAt: new Date() })
    .where(eq(runs.id, runId));

  return {
    runId,
    status: "succeeded",
    patchArtifactId: patchArtifactRow.id,
    patchBytes: patchDiff.length,
    filesChanged,
  };
}

// ── Deterministic scoring (validated tests) ─────────────────────────────────

async function scoreWithDeterministicTests(input: {
  db: DbClient;
  sandbox: RuntimeWorkspace;
  agentPlans: AgentPlan[];
  agentResults: BenchmarkBatchAgentResult[];
  caseVersionId: string;
}): Promise<void> {
  const { db, sandbox, agentPlans, agentResults, caseVersionId } = input;

  const specs = await db.query.testSpecs.findMany({
    where: eq(testSpecs.caseVersionId, caseVersionId),
    columns: {
      id: true,
      name: true,
      kind: true,
      status: true,
      filePath: true,
      testCommand: true,
      content: true,
    },
  });
  const accepted = specs.filter((s) => s.status === "accepted");
  const failToPass = accepted.filter((s) => s.kind === "fail_to_pass");
  const passToPass = accepted.filter((s) => s.kind === "pass_to_pass");

  for (let i = 0; i < agentPlans.length; i++) {
    const plan = agentPlans[i]!;
    const result = agentResults[i]!;
    if (result.status !== "succeeded") continue;

    let failToPassPassed = 0;
    let passToPassPassed = 0;

    for (const spec of failToPass) {
      if (await runTestSpec(sandbox, plan.worktreePath, spec)) failToPassPassed++;
    }
    for (const spec of passToPass) {
      if (await runTestSpec(sandbox, plan.worktreePath, spec)) passToPassPassed++;
    }

    const resolved =
      failToPassPassed === failToPass.length &&
      passToPassPassed === passToPass.length &&
      failToPass.length > 0;

    const evalRow = await db
      .insert(evaluations)
      .values({
        runId: plan.spec.runId,
        caseVersionId,
        evaluatorVersion: "pilab.benchmark-batch.deterministic.v1",
        status: resolved ? "passed" : "failed",
        resolved,
        failToPassPassed,
        failToPassTotal: failToPass.length,
        passToPassPassed,
        passToPassTotal: passToPass.length,
        rawResults: {
          source: "deterministic_tests",
          worktreePath: plan.worktreePath,
        },
        startedAt: new Date(),
        finishedAt: new Date(),
      })
      .returning();
    if (!evalRow[0]) {
      throw new Error(`Failed to insert evaluation for run ${plan.spec.runId}`);
    }

    result.score = resolved ? 100 : Math.round(
      (failToPassPassed + passToPassPassed) *
        100 /
        Math.max(1, failToPass.length + passToPass.length),
    );
  }
}

async function runTestSpec(
  sandbox: RuntimeWorkspace,
  worktreePath: string,
  spec: { filePath: string | null; testCommand: string; content: string | null },
): Promise<boolean> {
  if (spec.filePath && spec.content) {
    await sandbox.writeFile({
      path: `${worktreePath}/${spec.filePath}`,
      content: spec.content,
    });
  }
  const result = await sandbox.run({
    command: spec.testCommand,
    cwd: worktreePath,
    timeoutMs: 180_000,
  });
  return result.exitCode === 0;
}

// ── LLM evaluator (Pi agent in same sandbox) ───────────────────────────────

async function scoreWithEvaluator(input: {
  db: DbClient;
  sandbox: RuntimeWorkspace;
  experimentId: string;
  caseVersionId: string;
  agentPlans: AgentPlan[];
  agentResults: BenchmarkBatchAgentResult[];
  ctx: BatchContext;
  apiKey: string;
  evaluatorModelId: string;
  maxWallClockSeconds: number;
}): Promise<string | null> {
  const {
    db,
    sandbox,
    experimentId,
    caseVersionId,
    agentPlans,
    agentResults,
    ctx,
    apiKey,
    evaluatorModelId,
    maxWallClockSeconds,
  } = input;

  const evaluatorPath = `${REPO_ROOT}-evaluator`;
  await addWorktree({
    workspace: sandbox,
    root: REPO_ROOT,
    branch: "evaluator",
    worktreePath: evaluatorPath,
    baseRef: "base",
  });

  // Capture the gold patch as a file the evaluator can reference directly.
  const goldDiff = await sandbox.run({
    command: `git -C ${shellQuote(REPO_ROOT)} diff base..gold`,
    timeoutMs: 30_000,
  });
  await sandbox.writeFile({
    path: `${evaluatorPath}/GOLD.patch`,
    content: goldDiff.stdout || "",
  });

  const summary = [
    `# Evaluator brief`,
    ``,
    `## Issue`,
    `${ctx.issueTitle}`,
    ``,
    ctx.issueBody || "_(no body)_",
    ``,
    `## Agents under evaluation`,
    ...agentPlans.map((p, i) => {
      const r = agentResults[i]!;
      return `- agent-${i} (\`${p.spec.modelName}\`) — worktree: \`${p.worktreePath}\`, status: ${r.status}`;
    }),
    ``,
    `Gold patch is in \`${evaluatorPath}/GOLD.patch\`. Each agent's diff vs base: \`git -C ${REPO_ROOT} diff base..agent-N\`.`,
  ].join("\n");
  await sandbox.writeFile({ path: `${evaluatorPath}/BRIEF.md`, content: summary });

  const extra = [
    `Read BRIEF.md first. It lists the agents, their worktrees, and where to find the gold patch.`,
    `The agents' worktrees are sibling directories: ${agentPlans.map((p) => p.worktreePath).join(", ")}. You can \`cat\`, \`grep\`, \`git -C ${REPO_ROOT} diff base..agent-N\`, etc. — they're all readable from here.`,
    `Compute the four-axis score (correctness, codeQuality, ux, shipIt; each 1-5) for each agent, then compute overall (0-100) using weights 40/25/15/20.`,
  ].join("\n\n");

  const systemPrompt = buildPeerSystemPrompt({
    role: "evaluator",
    modelName: evaluatorModelId,
    agentIndex: 0,
    totalAgents: 1,
    peers: [],
    worktreePath: evaluatorPath,
    branch: "evaluator",
    extra,
  });

  const outputPath = `${evaluatorPath}/evaluator-output.json`;
  const userPrompt = [
    `Score each agent listed in BRIEF.md by comparing their worktree to GOLD.patch.`,
    `Write the result to \`${outputPath}\` as JSON:`,
    "```json",
    `{`,
    `  "scores": [`,
    `    { "agentIndex": 0, "branch": "agent-0", "overall": 0-100, "correctness": 1-5, "codeQuality": 1-5, "ux": 1-5, "shipIt": 1-5, "rationale": "..." }`,
    `  ]`,
    `}`,
    "```",
    `Output your usual FINAL: summary afterwards.`,
  ].join("\n");

  // Create the evaluator's run row up front so we can link agent runs to it.
  const [evalRunRow] = await db
    .insert(runs)
    .values({
      experimentId,
      caseVersionId,
      mode: "implementation_only",
      status: "running",
      stage: "grading",
      openRouterModelId: evaluatorModelId,
      startedAt: new Date(),
    })
    .returning({ id: runs.id });
  if (!evalRunRow) {
    throw new Error("Failed to create evaluator run row");
  }
  const evaluatorRunId = evalRunRow.id;

  const controller = new AbortController();
  try {
    await runSandboxPiAgent({
      workspace: sandbox,
      runId: evaluatorRunId,
      provider: "openrouter",
      modelName: evaluatorModelId,
      prompt: userPrompt,
      systemPrompt,
      apiKey,
      tools: EVALUATOR_TOOLS,
      timeoutMs: maxWallClockSeconds * 1000,
      signal: controller.signal,
      cwd: evaluatorPath,
      followUpInboxPath: null,
      onEvent: () => {},
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(runs)
      .set({ status: "failed", finishedAt: new Date(), error: { message } })
      .where(eq(runs.id, evaluatorRunId));
    return evaluatorRunId;
  }

  let scores: EvaluatorScore[];
  try {
    const raw = await sandbox.readFile(outputPath);
    const parsed: unknown = JSON.parse(raw);
    scores = parseEvaluatorOutput(parsed, agentPlans);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(runs)
      .set({
        status: "failed",
        finishedAt: new Date(),
        error: { message: `Evaluator output missing or invalid: ${message}` },
      })
      .where(eq(runs.id, evaluatorRunId));
    return evaluatorRunId;
  }

  // Persist scores against each agent's plan row (creating a plan row per agent
  // if it doesn't exist yet) and link agent runs to this evaluator run.
  for (const score of scores) {
    const plan = agentPlans[score.agentIndex];
    if (!plan) continue;
    const agentRunId = plan.spec.runId;
    const [planRow] = await db
      .insert(plans)
      .values({
        runId: agentRunId,
        caseVersionId,
        formatVersion: "pilab.benchmark-batch.evaluator.v1",
        planMarkdown: score.rationale ?? "",
        planJson: { source: "pi_evaluator" },
      })
      .returning({ id: plans.id });
    if (!planRow) continue;

    await db.insert(planScores).values({
      planId: planRow.id,
      caseVersionId,
      rubricVersion: "pilab.benchmark-batch.v1",
      promptVersion: "pilab.benchmark-batch.v1",
      overallScore: score.overall.toString(),
      correctnessScore: score.correctness ?? null,
      completenessScore: score.codeQuality ?? null,
      safetyScore: score.shipIt ?? null,
      dimensions: {
        correctness: score.correctness ?? null,
        codeQuality: score.codeQuality ?? null,
        ux: score.ux ?? null,
        shipIt: score.shipIt ?? null,
      },
      rationale: score.rationale ?? "",
    });

    await db
      .update(runs)
      .set({ evaluatorRunId })
      .where(eq(runs.id, agentRunId));

    const result = input.agentResults[score.agentIndex];
    if (result) {
      result.score = score.overall;
      if (score.rationale) result.rationale = score.rationale;
    }
  }

  await db
    .update(runs)
    .set({ status: "succeeded", finishedAt: new Date() })
    .where(eq(runs.id, evaluatorRunId));

  return evaluatorRunId;
}

function parseEvaluatorOutput(value: unknown, agentPlans: AgentPlan[]): EvaluatorScore[] {
  if (!isRecord(value) || !Array.isArray(value.scores)) {
    throw new Error(`Evaluator output must have a "scores" array`);
  }
  const out: EvaluatorScore[] = [];
  for (const entry of value.scores) {
    if (!isRecord(entry)) continue;
    const agentIndex = readNumber(entry, "agentIndex");
    if (agentIndex == null || agentIndex < 0 || agentIndex >= agentPlans.length) continue;
    const overall = readNumber(entry, "overall");
    if (overall == null) continue;
    const branch = readString(entry, "branch") ?? agentPlans[agentIndex]!.branch;
    const score: EvaluatorScore = {
      agentIndex,
      branch,
      overall: clamp(overall, 0, 100),
    };
    const correctness = readNumber(entry, "correctness");
    if (correctness != null) score.correctness = clamp(correctness, 1, 5);
    const codeQuality = readNumber(entry, "codeQuality");
    if (codeQuality != null) score.codeQuality = clamp(codeQuality, 1, 5);
    const ux = readNumber(entry, "ux");
    if (ux != null) score.ux = clamp(ux, 1, 5);
    const shipIt = readNumber(entry, "shipIt");
    if (shipIt != null) score.shipIt = clamp(shipIt, 1, 5);
    const rationale = readString(entry, "rationale");
    if (rationale) score.rationale = rationale;
    out.push(score);
  }
  if (out.length === 0) {
    throw new Error(`Evaluator output had no usable scores`);
  }
  return out;
}

// ── Context loading ─────────────────────────────────────────────────────────

type BatchContext = {
  repoUrl: string | null;
  baseCommitSha: string | null;
  goldCommitSha: string | null;
  evaluatorStrategy: "deterministic_tests" | "llm_evaluator_only" | null;
  issueTitle: string;
  issueBody: string;
};

async function loadBatchContext(
  db: DbClient,
  caseVersionId: string,
): Promise<BatchContext> {
  const cv = await db.query.caseVersions.findFirst({
    where: eq(caseVersions.id, caseVersionId),
  });
  if (!cv) throw new Error(`Case version ${caseVersionId} not found`);

  const repoUrl =
    cv.repoOwner && cv.repoName
      ? `https://github.com/${cv.repoOwner}/${cv.repoName}.git`
      : null;

  let issueTitle = "";
  let issueBody = "";
  if (cv.githubIssueId) {
    const issue = await db.query.githubIssues.findFirst({
      where: eq(githubIssues.id, cv.githubIssueId),
      columns: { title: true, body: true },
    });
    if (issue) {
      issueTitle = issue.title ?? "";
      issueBody = issue.body ?? "";
    }
  }

  return {
    repoUrl,
    baseCommitSha: cv.baseCommitSha,
    goldCommitSha: cv.goldCommitSha,
    evaluatorStrategy: cv.evaluatorStrategy,
    issueTitle,
    issueBody,
  };
}

async function markRuns(
  db: DbClient,
  runIds: string[],
  updates: { status: typeof runs.$inferInsert["status"]; startedAt?: Date },
): Promise<void> {
  if (runIds.length === 0) return;
  const set: Partial<typeof runs.$inferInsert> = { status: updates.status };
  if (updates.startedAt) set.startedAt = updates.startedAt;
  await db.update(runs).set(set).where(inArray(runs.id, runIds));
}

// ── Tiny helpers ────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNumber(value: Record<string, unknown>, key: string): number | null {
  const inner = value[key];
  return typeof inner === "number" && Number.isFinite(inner) ? inner : null;
}

function readString(value: Record<string, unknown>, key: string): string | null {
  const inner = value[key];
  return typeof inner === "string" ? inner : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
