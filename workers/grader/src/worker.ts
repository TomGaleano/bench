import { Worker } from "bullmq";
import { eq } from "drizzle-orm";

import {
  createDb,
  artifacts,
  caseVersions,
  evaluations,
  githubIssues,
  graderVerdicts,
  patches,
  planScores,
  plans,
  runs,
} from "@pilab/db";
import type { DbClient } from "@pilab/db";
import {
  GRADING_EXTERNAL_QUEUE_NAME,
  GRADING_IMPLEMENTATION_QUEUE_NAME,
  GRADING_PLAN_QUEUE_NAME,
  createRedisConnection,
  type GradingExternalJobData,
  type GradingExternalJobResult,
  type GradingImplementationJobData,
  type GradingImplementationJobResult,
  type GradingPlanJobData,
  type GradingPlanJobResult,
} from "@pilab/jobs";
import { createObjectStore, type JsonValue } from "@pilab/object-store";

import {
  GRADER_OUTPUT_FILENAME,
  GRADER_SANDBOX_ROOT,
  runPiJsonGrader,
} from "@pilab/runtime";

// ── Configuration ──────────────────────────────────────────────────────────

const databaseUrl = readRequiredEnv("DATABASE_URL");
const redisUrl = readRequiredEnv("REDIS_URL");
const openRouterApiKey = readRequiredEnv("OPENROUTER_API_KEY");
const defaultJudgeModelId =
  process.env.GRADER_MODEL_ID ?? "anthropic/claude-haiku-4-5";

const db = createDb(databaseUrl);
const connection = createRedisConnection(redisUrl, { maxRetriesPerRequest: null });
const objectStore = createObjectStore({
  endpoint: process.env.S3_ENDPOINT ?? "http://localhost:59000",
  accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "minioadmin",
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "minioadmin",
  bucket: process.env.S3_BUCKET ?? "pilab-artifacts",
  region: process.env.S3_REGION ?? "us-east-1",
  forcePathStyle: true,
});

// ── Scoring helpers ────────────────────────────────────────────────────────

function computeJaccardSimilarity(a: string, b: string): number {
  const extractLines = (diff: string): string[] =>
    diff
      .split("\n")
      .filter((l) => l.startsWith("+") || l.startsWith("-"))
      .map((l) => l.slice(1).trim())
      .filter((l) => l.length > 0);

  const aLines = extractLines(a);
  const bLines = extractLines(b);

  if (aLines.length === 0 && bLines.length === 0) return 1;

  const aSet = new Set(aLines);
  const bSet = new Set(bLines);

  const intersection = [...aSet].filter((l) => bSet.has(l));
  const union = new Set([...aSet, ...bSet]);

  return union.size === 0 ? 0 : intersection.length / union.size;
}

function clampScore(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNumber(value: Record<string, unknown>, key: string): number | null {
  const inner = value[key];
  return typeof inner === "number" && Number.isFinite(inner) ? inner : null;
}

function readString(value: Record<string, unknown>, key: string): string {
  const inner = value[key];
  return typeof inner === "string" ? inner : "";
}

// ── Plan grading ───────────────────────────────────────────────────────────

type PlanScoreParsed = {
  overallScore: number;
  correctnessScore: number;
  completenessScore: number;
  safetyScore: number;
  rationale: string;
};

function parsePlanScore(value: unknown): PlanScoreParsed {
  if (!isRecord(value)) {
    throw new Error("Plan grader output must be a JSON object");
  }
  const overallScore = readNumber(value, "overallScore");
  const correctnessScore = readNumber(value, "correctnessScore");
  const completenessScore = readNumber(value, "completenessScore");
  const safetyScore = readNumber(value, "safetyScore");
  if (
    overallScore == null ||
    correctnessScore == null ||
    completenessScore == null ||
    safetyScore == null
  ) {
    throw new Error("Plan grader output missing numeric score fields");
  }
  return {
    overallScore,
    correctnessScore,
    completenessScore,
    safetyScore,
    rationale: readString(value, "rationale"),
  };
}

async function gradePlan(
  db: DbClient,
  job: { data: GradingPlanJobData },
): Promise<GradingPlanJobResult> {
  const { runId, planId, caseVersionId } = job.data;
  const judgeModelId = job.data.judgeModelId ?? defaultJudgeModelId;

  console.log(`[grader] grading plan ${planId} for run ${runId}`);

  const plan = await db.query.plans.findFirst({
    where: eq(plans.id, planId),
  });
  if (!plan) {
    throw new Error(`Plan not found: ${planId}`);
  }

  const planContent = await loadPlanContent(plan);
  if (!planContent || planContent.trim().length === 0) {
    throw new Error(`Plan ${planId} has no readable content`);
  }

  const caseVersion = await db.query.caseVersions.findFirst({
    where: eq(caseVersions.id, caseVersionId),
  });
  if (!caseVersion) {
    throw new Error(`Case version not found: ${caseVersionId}`);
  }

  const { issueTitle, issueBody } = await loadIssue(db, caseVersion.githubIssueId);
  const goldPatchContent = await loadGoldPatch(caseVersion.goldPatchArtifactId);
  if (!goldPatchContent || goldPatchContent.trim().length === 0) {
    throw new Error(`Gold patch not found for case version ${caseVersionId}`);
  }

  const systemPrompt = [
    `You are an expert code reviewer evaluating an AI agent's implementation plan.`,
    `You will be shown the GitHub issue, the agent's plan, and the gold patch (the actual merged fix).`,
    `Score the plan on:`,
    `- correctnessScore (1-10): root-cause diagnosis and the right files/functions to change`,
    `- completenessScore (1-10): coverage of edge cases, test updates, related files`,
    `- safetyScore (1-10): minimality + low regression risk`,
    `- overallScore (1-10): overall quality of the plan as a blueprint for implementation`,
    ``,
    `IMPORTANT: the plan is natural-language. Do NOT penalize it for not matching the gold patch word-for-word. What matters is correct diagnosis + viable fix.`,
    ``,
    `Read all three files: ISSUE.md, PLAN.md, GOLD.patch. They are in your working directory.`,
    `Write your final scores as JSON to \`${GRADER_SANDBOX_ROOT}/${GRADER_OUTPUT_FILENAME}\` with shape:`,
    `{ "overallScore": 1-10, "correctnessScore": 1-10, "completenessScore": 1-10, "safetyScore": 1-10, "rationale": "..." }`,
    `Then write a FINAL: summary line.`,
  ].join("\n");

  const userPrompt = `Read ISSUE.md, PLAN.md, and GOLD.patch, then score the plan and write the JSON to ${GRADER_OUTPUT_FILENAME}.`;

  const parsed = await runPiJsonGrader<unknown>({
    jobTag: "plan",
    apiKey: openRouterApiKey,
    modelId: judgeModelId,
    systemPrompt,
    userPrompt,
    contextFiles: [
      { name: "ISSUE.md", content: renderIssueDoc(issueTitle, issueBody) },
      { name: "PLAN.md", content: planContent },
      { name: "GOLD.patch", content: goldPatchContent },
    ],
  });
  const scores = parsePlanScore(parsed);

  const overallScore = clampScore(Math.round(scores.overallScore), 1, 10);
  const correctnessScore = clampScore(Math.round(scores.correctnessScore), 1, 10);
  const completenessScore = clampScore(Math.round(scores.completenessScore), 1, 10);
  const safetyScore = clampScore(Math.round(scores.safetyScore), 1, 10);

  const [inserted] = await db
    .insert(planScores)
    .values({
      planId,
      caseVersionId,
      rubricVersion: "pilab.grading-plan.pi.v1",
      promptVersion: "pilab.grading-plan.pi.v1",
      judgeRunOrdinal: 1,
      overallScore: String(overallScore),
      correctnessScore,
      completenessScore,
      safetyScore,
      rationale: scores.rationale,
      isPublic: false,
    })
    .returning({ id: planScores.id });
  if (!inserted) {
    throw new Error("Failed to insert plan score");
  }

  console.log(
    `[grader] plan ${planId} scored: overall=${overallScore} correctness=${correctnessScore} completeness=${completenessScore} safety=${safetyScore}`,
  );

  return {
    planScoreId: inserted.id,
    overallScore,
    correctnessScore,
    completenessScore,
    safetyScore,
    rationale: scores.rationale,
  };
}

// ── Implementation grading ─────────────────────────────────────────────────

type ImplementationScoreParsed = {
  overallScore: number;
  diffSimilarityScore: number;
  rationale: string;
};

function parseImplementationScore(value: unknown): ImplementationScoreParsed {
  if (!isRecord(value)) {
    throw new Error("Impl grader output must be a JSON object");
  }
  const overallScore = readNumber(value, "overallScore");
  const diffSimilarityScore = readNumber(value, "diffSimilarityScore");
  if (overallScore == null || diffSimilarityScore == null) {
    throw new Error("Impl grader output missing numeric score fields");
  }
  return {
    overallScore,
    diffSimilarityScore,
    rationale: readString(value, "rationale"),
  };
}

async function gradeImplementation(
  db: DbClient,
  job: { data: GradingImplementationJobData },
): Promise<GradingImplementationJobResult> {
  const { runId, patchId, caseVersionId } = job.data;
  const judgeModelId = job.data.judgeModelId ?? defaultJudgeModelId;

  console.log(`[grader] grading implementation patch ${patchId} for run ${runId}`);

  const patch = await db.query.patches.findFirst({
    where: eq(patches.id, patchId),
  });
  if (!patch) {
    throw new Error(`Patch not found: ${patchId}`);
  }

  const predictedPatchContent = await loadPatchContent(patch);
  if (!predictedPatchContent || predictedPatchContent.trim().length === 0) {
    throw new Error(`Patch artifact content not found for patch ${patchId}`);
  }

  const caseVersion = await db.query.caseVersions.findFirst({
    where: eq(caseVersions.id, caseVersionId),
  });
  if (!caseVersion) {
    throw new Error(`Case version not found: ${caseVersionId}`);
  }

  const goldPatchContent = await loadGoldPatch(caseVersion.goldPatchArtifactId);
  if (!goldPatchContent || goldPatchContent.trim().length === 0) {
    throw new Error(`Gold patch not found for case version ${caseVersionId}`);
  }

  const computedJaccard = computeJaccardSimilarity(
    predictedPatchContent,
    goldPatchContent,
  );
  const computedJaccardRounded = Math.round(computedJaccard * 10_000) / 10_000;

  const systemPrompt = [
    `You are an expert code reviewer comparing a predicted patch (PREDICTED.patch) to the gold (correct) patch (GOLD.patch).`,
    `Score the predicted patch on:`,
    `- overallScore (1-10): how well it matches the gold patch in intent + correctness`,
    `- diffSimilarityScore (0-1): how similar the actual code changes are (your own judgment, not a mechanical metric)`,
    ``,
    `Read both files from your working directory.`,
    `Write your final scores as JSON to \`${GRADER_SANDBOX_ROOT}/${GRADER_OUTPUT_FILENAME}\` with shape:`,
    `{ "overallScore": 1-10, "diffSimilarityScore": 0-1, "rationale": "..." }`,
    `Then write a FINAL: summary line.`,
  ].join("\n");

  const userPrompt = `Read PREDICTED.patch and GOLD.patch, then score the predicted patch and write the JSON to ${GRADER_OUTPUT_FILENAME}.`;

  const parsed = await runPiJsonGrader<unknown>({
    jobTag: "impl",
    apiKey: openRouterApiKey,
    modelId: judgeModelId,
    systemPrompt,
    userPrompt,
    contextFiles: [
      { name: "PREDICTED.patch", content: predictedPatchContent },
      { name: "GOLD.patch", content: goldPatchContent },
    ],
  });
  const scores = parseImplementationScore(parsed);

  const overallScore = clampScore(Math.round(scores.overallScore), 1, 10);
  const llmSimilarityScore = clampScore(scores.diffSimilarityScore, 0, 1);

  let evaluationId: string | undefined;
  const existingEvaluation = await db.query.evaluations.findFirst({
    where: eq(evaluations.patchId, patchId),
  });
  if (existingEvaluation) {
    evaluationId = existingEvaluation.id;
    await db
      .update(evaluations)
      .set({
        diffSimilarityScore: String(computedJaccardRounded),
        status: "passed",
        finishedAt: new Date(),
        rawResults: {
          ...(existingEvaluation.rawResults as Record<string, unknown>),
          grader: {
            overallScore,
            diffSimilarityScore: llmSimilarityScore,
            computedJaccard: computedJaccardRounded,
            rationale: scores.rationale,
            judgeModelId,
          },
        },
      })
      .where(eq(evaluations.id, existingEvaluation.id));
  } else {
    const [created] = await db
      .insert(evaluations)
      .values({
        runId,
        patchId,
        caseVersionId,
        evaluatorVersion: "pilab.grader.pi.v1",
        status: "passed",
        resolved: true,
        diffSimilarityScore: String(computedJaccardRounded),
        rawResults: {
          grader: {
            overallScore,
            diffSimilarityScore: llmSimilarityScore,
            computedJaccard: computedJaccardRounded,
            rationale: scores.rationale,
            judgeModelId,
          },
        },
        startedAt: new Date(),
        finishedAt: new Date(),
      })
      .returning({ id: evaluations.id });
    if (!created) {
      throw new Error("Failed to create evaluation record");
    }
    evaluationId = created.id;
  }

  if (!evaluationId) {
    throw new Error("Evaluation record not available");
  }

  console.log(
    `[grader] implementation ${patchId} scored: overall=${overallScore} jaccard=${computedJaccardRounded}`,
  );

  return {
    implementationScoreId: evaluationId,
    overallScore,
    diffSimilarityScore: computedJaccardRounded,
    rationale: scores.rationale,
  };
}

// ── Head-to-head external comparison ───────────────────────────────────────

type ExternalVerdictParsed = {
  winner: "A" | "B" | "tie";
  rationale: string;
};

function parseExternalVerdict(value: unknown): ExternalVerdictParsed {
  if (!isRecord(value)) {
    throw new Error("External grader output must be a JSON object");
  }
  const winner = value.winner;
  if (winner !== "A" && winner !== "B" && winner !== "tie") {
    throw new Error(`External grader winner must be A | B | tie, got: ${String(winner)}`);
  }
  return { winner, rationale: readString(value, "rationale") };
}

async function gradeExternal(
  db: DbClient,
  job: { data: GradingExternalJobData },
): Promise<GradingExternalJobResult> {
  const { experimentId, runAId, runBId } = job.data;
  const judgeModelId = job.data.judgeModelId ?? defaultJudgeModelId;

  console.log(
    `[grader] comparing runs A=${runAId} vs B=${runBId} for experiment ${experimentId}`,
  );

  const [runA, runB] = await Promise.all([
    db.query.runs.findFirst({ where: eq(runs.id, runAId) }),
    db.query.runs.findFirst({ where: eq(runs.id, runBId) }),
  ]);
  if (!runA) throw new Error(`Run A not found: ${runAId}`);
  if (!runB) throw new Error(`Run B not found: ${runBId}`);

  const [patchesA, patchesB, evalsA, evalsB] = await Promise.all([
    db.query.patches.findMany({ where: eq(patches.runId, runAId) }),
    db.query.patches.findMany({ where: eq(patches.runId, runBId) }),
    db.query.evaluations.findMany({ where: eq(evaluations.runId, runAId) }),
    db.query.evaluations.findMany({ where: eq(evaluations.runId, runBId) }),
  ]);

  const patchContentA = (await Promise.all(patchesA.map(loadPatchContent))).join("\n\n");
  const patchContentB = (await Promise.all(patchesB.map(loadPatchContent))).join("\n\n");

  const summaryA = evalsA[0];
  const summaryB = evalsB[0];

  const summary = [
    `# Comparison brief`,
    ``,
    `## Agent A test results`,
    summaryA
      ? `Status: ${summaryA.status}, Resolved: ${summaryA.resolved}, Fail-to-pass: ${summaryA.failToPassPassed}/${summaryA.failToPassTotal}, Pass-to-pass: ${summaryA.passToPassPassed}/${summaryA.passToPassTotal}`
      : "No evaluation results",
    ``,
    `## Agent B test results`,
    summaryB
      ? `Status: ${summaryB.status}, Resolved: ${summaryB.resolved}, Fail-to-pass: ${summaryB.failToPassPassed}/${summaryB.failToPassTotal}, Pass-to-pass: ${summaryB.passToPassPassed}/${summaryB.passToPassTotal}`
      : "No evaluation results",
  ].join("\n");

  const systemPrompt = [
    `You are an impartial judge comparing two coding agent solutions to the same GitHub issue.`,
    `Read AGENT_A.patch, AGENT_B.patch, and SUMMARY.md (test result summaries) from your working directory.`,
    `Pick the better solution or declare a tie.`,
    ``,
    `Write your final verdict as JSON to \`${GRADER_SANDBOX_ROOT}/${GRADER_OUTPUT_FILENAME}\` with shape:`,
    `{ "winner": "A" | "B" | "tie", "rationale": "..." }`,
    `Then write a FINAL: summary line.`,
  ].join("\n");

  const userPrompt = `Compare AGENT_A.patch against AGENT_B.patch, factor in SUMMARY.md, then write the verdict JSON to ${GRADER_OUTPUT_FILENAME}.`;

  const parsed = await runPiJsonGrader<unknown>({
    jobTag: "external",
    apiKey: openRouterApiKey,
    modelId: judgeModelId,
    systemPrompt,
    userPrompt,
    contextFiles: [
      { name: "AGENT_A.patch", content: patchContentA || "(no patch)" },
      { name: "AGENT_B.patch", content: patchContentB || "(no patch)" },
      { name: "SUMMARY.md", content: summary },
    ],
  });
  const verdict = parseExternalVerdict(parsed);

  let winnerRunId: string | null = null;
  if (verdict.winner === "A") winnerRunId = runAId;
  else if (verdict.winner === "B") winnerRunId = runBId;

  const [inserted] = await db
    .insert(graderVerdicts)
    .values({
      experimentId,
      runAId,
      runBId,
      winnerRunId,
      reasoning: verdict.rationale,
      metadata: { judgeModelId, graderVersion: "pilab.grader.pi.v1" },
    })
    .returning({ id: graderVerdicts.id });
  if (!inserted) {
    throw new Error("Failed to insert grader verdict");
  }

  console.log(
    `[grader] external verdict ${inserted.id}: winner=${verdict.winner} (${winnerRunId ?? "tie"})`,
  );

  return {
    graderVerdictId: inserted.id,
    winnerRunId,
    rationale: verdict.rationale,
  };
}

// ── Artifact / DB loaders ──────────────────────────────────────────────────

async function loadPlanContent(plan: typeof plans.$inferSelect): Promise<string> {
  if (plan.rawArtifactId) {
    const planArtifact = await db.query.artifacts.findFirst({
      where: eq(artifacts.id, plan.rawArtifactId),
    });
    if (planArtifact) {
      try {
        const planJson = await objectStore.getJsonArtifact<JsonValue>(
          planArtifact.objectKey,
        );
        if (isRecord(planJson) && typeof planJson.planMarkdown === "string") {
          return planJson.planMarkdown;
        }
        return typeof planJson === "string"
          ? planJson
          : JSON.stringify(planJson, null, 2);
      } catch (error) {
        console.warn(
          `[grader] could not load plan artifact ${planArtifact.objectKey}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }
  return plan.planMarkdown ?? JSON.stringify(plan.planJson ?? {});
}

async function loadIssue(
  db: DbClient,
  githubIssueId: string | null,
): Promise<{ issueTitle: string; issueBody: string }> {
  if (!githubIssueId) return { issueTitle: "", issueBody: "" };
  const issue = await db.query.githubIssues.findFirst({
    where: eq(githubIssues.id, githubIssueId),
  });
  return {
    issueTitle: issue?.title ?? "",
    issueBody: issue?.body ?? "",
  };
}

async function loadGoldPatch(goldPatchArtifactId: string | null): Promise<string> {
  if (!goldPatchArtifactId) return "";
  const goldArtifact = await db.query.artifacts.findFirst({
    where: eq(artifacts.id, goldPatchArtifactId),
  });
  if (!goldArtifact) return "";
  try {
    return await objectStore.getArtifactText(goldArtifact.objectKey);
  } catch {
    return "";
  }
}

async function loadPatchContent(
  patchRow: typeof patches.$inferSelect,
): Promise<string> {
  if (!patchRow.artifactId) return "";
  const artifact = await db.query.artifacts.findFirst({
    where: eq(artifacts.id, patchRow.artifactId),
  });
  if (!artifact) return "";
  try {
    return await objectStore.getArtifactText(artifact.objectKey);
  } catch {
    return "";
  }
}

function renderIssueDoc(title: string, body: string): string {
  return `# ${title || "(no title)"}\n\n${body || "_(no body)_"}\n`;
}

// ── Worker setup ───────────────────────────────────────────────────────────

const planWorker = new Worker<GradingPlanJobData, GradingPlanJobResult>(
  GRADING_PLAN_QUEUE_NAME,
  async (job) => gradePlan(db, job),
  { connection, concurrency: 1 },
);

const implementationWorker = new Worker<
  GradingImplementationJobData,
  GradingImplementationJobResult
>(
  GRADING_IMPLEMENTATION_QUEUE_NAME,
  async (job) => gradeImplementation(db, job),
  { connection, concurrency: 1 },
);

const externalWorker = new Worker<
  GradingExternalJobData,
  GradingExternalJobResult
>(
  GRADING_EXTERNAL_QUEUE_NAME,
  async (job) => gradeExternal(db, job),
  { connection, concurrency: 1 },
);

function attachEvents<DataType = unknown, ResultType = unknown>(
  worker: Worker<DataType, ResultType>,
  label: string,
): void {
  worker.on("ready", () => {
    console.log(`[grader] ${label} worker ready`);
  });
  worker.on("active", (job) => {
    console.log(`[grader] ${label} started job ${job.id ?? "(unknown)"} (${job.name})`);
  });
  worker.on("completed", (job) => {
    console.log(`[grader] ${label} completed job ${job.id ?? "(unknown)"}`);
  });
  worker.on("failed", (job, error) => {
    console.error(`[grader] ${label} failed job ${job?.id ?? "(unknown)"}: ${error.message}`);
  });
  worker.on("error", (error) => {
    console.error(`[grader] ${label} worker error: ${error.message}`);
  });
}

attachEvents(planWorker, "plan");
attachEvents(implementationWorker, "implementation");
attachEvents(externalWorker, "external");

process.once("SIGINT", () => {
  void shutdown("SIGINT");
});

process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  console.log(`[grader] received ${signal}; shutting down`);

  try {
    await Promise.all([
      planWorker.close(),
      implementationWorker.close(),
      externalWorker.close(),
    ]);
    await connection.quit();
    console.log("[grader] shutdown complete");
    process.exit(0);
  } catch (error) {
    console.error(
      `[grader] shutdown failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    process.exit(1);
  }
}

function readRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}
