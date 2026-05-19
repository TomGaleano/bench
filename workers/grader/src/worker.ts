import { Worker } from "bullmq";
import { eq } from "drizzle-orm";

import { createDb, artifacts, caseVersions, evaluations, githubIssues, graderVerdicts, patches, planScores, plans, runs } from "@pilab/db";
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

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const databaseUrl = readRequiredEnv("DATABASE_URL");
const redisUrl = readRequiredEnv("REDIS_URL");
const openRouterApiKey = readRequiredEnv("OPENROUTER_API_KEY");
const defaultJudgeModelId = "openai/gpt-5.4-mini";

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

// ---------------------------------------------------------------------------
// OpenRouter structured-output caller
// ---------------------------------------------------------------------------

type OpenRouterCallConfig = {
  apiKey: string;
  modelId: string;
  fetchImpl?: typeof fetch;
};

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

type OpenRouterChatResponse = {
  id?: string;
  model?: string;
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
  usage?: JsonValue;
  error?: {
    message?: string;
  };
};

const planScoreSchema = {
  type: "object",
  properties: {
    overallScore: { type: "number" },
    correctnessScore: { type: "number" },
    completenessScore: { type: "number" },
    safetyScore: { type: "number" },
    rationale: { type: "string" },
  },
  required: [
    "overallScore",
    "correctnessScore",
    "completenessScore",
    "safetyScore",
    "rationale",
  ],
  additionalProperties: false,
} as const;

const implementationScoreSchema = {
  type: "object",
  properties: {
    overallScore: { type: "number" },
    diffSimilarityScore: { type: "number" },
    rationale: { type: "string" },
  },
  required: ["overallScore", "diffSimilarityScore", "rationale"],
  additionalProperties: false,
} as const;

const externalVerdictSchema = {
  type: "object",
  properties: {
    winner: { type: "string", enum: ["A", "B", "tie"] },
    rationale: { type: "string" },
  },
  required: ["winner", "rationale"],
  additionalProperties: false,
} as const;

async function callOpenRouterStructured<T>(
  config: OpenRouterCallConfig,
  schema: object,
  schemaName: string,
  messages: ChatMessage[],
  validator: (value: unknown) => value is T,
): Promise<{ result: T; rawContent: string }> {
  const fetchFn = config.fetchImpl ?? fetch;
  const maxAttempts = 2;
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const effectiveMessages =
      attempt === 1
        ? messages
        : [
            ...messages,
            {
              role: "user" as const,
              content: [
                "Previous attempt did not return valid JSON matching the required schema.",
                "Return ONLY a valid JSON object with all required fields.",
                `Previous error: ${lastError?.message ?? "unknown"}`,
              ].join(" "),
            },
          ];

    const response = await fetchFn(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
          "X-OpenRouter-Title": "Pi Lab Grader",
        },
        body: JSON.stringify({
          model: config.modelId,
          messages: effectiveMessages,
          response_format: {
            type: "json_schema",
            json_schema: {
              name: schemaName,
              strict: true,
              schema,
            },
          },
          temperature: 0,
          max_tokens: attempt === 1 ? 3200 : 2200,
        }),
      },
    );

    const raw = (await response.json()) as OpenRouterChatResponse;

    if (!response.ok) {
      throw new Error(
        `OpenRouter grader failed with HTTP ${response.status}: ${
          raw.error?.message ?? "unknown error"
        }`,
      );
    }

    const content = raw.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("OpenRouter grader returned no message content");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      // Try extracting JSON from markdown fences
      const extracted = extractJsonFromContent(content);
      if (extracted !== undefined) {
        try {
          parsed = JSON.parse(extracted);
        } catch {
          // fall through to error
        }
      }

      if (parsed === undefined) {
        lastError = new Error(
          `OpenRouter grader returned malformed JSON: ${
            content.length > 200 ? `${content.slice(0, 200)}...` : content
          }`,
        );
        if (attempt < maxAttempts) continue;
        throw lastError;
      }
    }

    if (!validator(parsed)) {
      lastError = new Error(
        "OpenRouter grader returned JSON that does not match the expected schema",
      );
      if (attempt < maxAttempts) continue;
      throw lastError;
    }

    return { result: parsed, rawContent: content };
  }

  throw lastError ?? new Error("OpenRouter structured call failed");
}

function extractJsonFromContent(content: string): string | undefined {
  // Try JSON code fence
  const fenceMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch?.[1]) {
    const inner = fenceMatch[1].trim();
    if (inner.startsWith("{")) return inner;
  }

  // Try to find a JSON object anywhere
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    return jsonMatch[0];
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Scoring helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Plan grading processor
// ---------------------------------------------------------------------------

type PlanScoreParsed = {
  overallScore: number;
  correctnessScore: number;
  completenessScore: number;
  safetyScore: number;
  rationale: string;
};

function isValidPlanScore(value: unknown): value is PlanScoreParsed {
  if (!isRecord(value)) return false;
  if (typeof value.overallScore !== "number") return false;
  if (typeof value.correctnessScore !== "number") return false;
  if (typeof value.completenessScore !== "number") return false;
  if (typeof value.safetyScore !== "number") return false;
  if (typeof value.rationale !== "string") return false;
  return true;
}

async function gradePlan(
  db: DbClient,
  job: { data: GradingPlanJobData },
): Promise<GradingPlanJobResult> {
  const { runId, planId, caseVersionId } = job.data;
  const judgeModelId = job.data.judgeModelId ?? defaultJudgeModelId;

  console.log(`[grader] grading plan ${planId} for run ${runId}`);

  // 1. Load the plan
  const plan = await db.query.plans.findFirst({
    where: eq(plans.id, planId),
  });
  if (!plan) {
    throw new Error(`Plan not found: ${planId}`);
  }

  // 2. Load the plan artifact from object store
  const planArtifact = plan.rawArtifactId
    ? await db.query.artifacts.findFirst({
        where: eq(artifacts.id, plan.rawArtifactId),
      })
    : undefined;

  let planContent = "";
  if (planArtifact) {
    try {
      const planJson = await objectStore.getJsonArtifact<JsonValue>(
        planArtifact.objectKey,
      );
      planContent = isRecord(planJson) &&
        typeof planJson.planMarkdown === "string"
        ? planJson.planMarkdown
        : typeof planJson === "string"
          ? planJson
          : JSON.stringify(planJson, null, 2);
    } catch (error) {
      console.warn(
        `[grader] could not load plan artifact ${planArtifact.objectKey}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      // Fall back to stored plan fields
      planContent = plan.planMarkdown ?? JSON.stringify(plan.planJson);
    }
  } else {
    planContent = plan.planMarkdown ?? JSON.stringify(plan.planJson);
  }

  if (!planContent || planContent.trim().length === 0) {
    throw new Error(`Plan ${planId} has no readable content`);
  }

  // 3. Load the case version and associated issue
  const caseVersion = await db.query.caseVersions.findFirst({
    where: eq(caseVersions.id, caseVersionId),
  });
  if (!caseVersion) {
    throw new Error(`Case version not found: ${caseVersionId}`);
  }

  let issueTitle = "";
  let issueBody = "";
  if (caseVersion.githubIssueId) {
    const issue = await db.query.githubIssues.findFirst({
      where: eq(githubIssues.id, caseVersion.githubIssueId),
    });
    if (issue) {
      issueTitle = issue.title ?? "";
      issueBody = issue.body ?? "";
    }
  }

  // 4. Load the gold patch artifact
  let goldPatchContent = "";
  if (caseVersion.goldPatchArtifactId) {
    const goldArtifact = await db.query.artifacts.findFirst({
      where: eq(artifacts.id, caseVersion.goldPatchArtifactId),
    });
    if (goldArtifact) {
      goldPatchContent = await objectStore.getArtifactText(
        goldArtifact.objectKey,
      );
    }
  }

  if (!goldPatchContent || goldPatchContent.trim().length === 0) {
    throw new Error(
      `Gold patch not found for case version ${caseVersionId}`,
    );
  }

  // 5. Call OpenRouter with issue-aware prompt
  const { result: scores } = await callOpenRouterStructured<PlanScoreParsed>(
    { apiKey: openRouterApiKey, modelId: judgeModelId },
    planScoreSchema,
    "pilab_plan_score",
    [
      {
        role: "system",
        content: [
          "You are an expert code reviewer evaluating an AI agent's implementation plan.",
          "",
          "The agent was given a GitHub issue and asked to produce a plan for fixing it.",
          "Your job is to evaluate whether the plan correctly diagnoses the problem and proposes a viable fix.",
          "",
          "IMPORTANT: The plan is written in natural language, not code. Do NOT penalize the plan for not matching the gold patch word-for-word. What matters is whether the plan correctly identifies the root cause and proposes a fix that would resolve the issue.",
          "",
          "Score the plan on:",
          "- Correctness (1-10): Did the agent correctly diagnose the root cause described in the issue? Did it identify the right files and functions to modify?",
          "- Completeness (1-10): Does the plan cover all necessary changes to fix the issue? Does it mention test updates, edge cases, or related files that need changing?",
          "- Safety (1-10): Are the proposed changes safe, minimal, and unlikely to cause regressions?",
          "- Overall (1-10): Overall quality of the plan as a blueprint for implementation.",
          "",
          "Return ONLY a JSON object with fields: overallScore, correctnessScore, completenessScore, safetyScore, rationale (string explaining your scoring).",
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          "## GitHub Issue",
          "",
          "**Title:** " + issueTitle,
          "",
          issueBody,
          "",
          "## Agent's Plan",
          "",
          planContent,
          "",
          "## Gold Patch (the actual fix that was merged)",
          "",
          "```diff",
          goldPatchContent,
          "```",
        ].join("\n"),
      },
    ],
    isValidPlanScore,
  );

  // 6. Clamp scores to 1-10
  const overallScore = clampScore(Math.round(scores.overallScore), 1, 10);
  const correctnessScore = clampScore(
    Math.round(scores.correctnessScore),
    1,
    10,
  );
  const completenessScore = clampScore(
    Math.round(scores.completenessScore),
    1,
    10,
  );
  const safetyScore = clampScore(Math.round(scores.safetyScore), 1, 10);

  // 7. Insert into plan_scores
  const [inserted] = await db
    .insert(planScores)
    .values({
      planId,
      caseVersionId,
      rubricVersion: "pilab.grading-plan.v2",
      promptVersion: "pilab.grading-plan.v2",
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

// ---------------------------------------------------------------------------
// Implementation grading processor
// ---------------------------------------------------------------------------

type ImplementationScoreParsed = {
  overallScore: number;
  diffSimilarityScore: number;
  rationale: string;
};

function isValidImplementationScore(
  value: unknown,
): value is ImplementationScoreParsed {
  if (!isRecord(value)) return false;
  if (typeof value.overallScore !== "number") return false;
  if (typeof value.diffSimilarityScore !== "number") return false;
  if (typeof value.rationale !== "string") return false;
  return true;
}

async function gradeImplementation(
  db: DbClient,
  job: { data: GradingImplementationJobData },
): Promise<GradingImplementationJobResult> {
  const { runId, patchId, caseVersionId } = job.data;
  const judgeModelId = job.data.judgeModelId ?? defaultJudgeModelId;

  console.log(`[grader] grading implementation patch ${patchId} for run ${runId}`);

  // 1. Load the predicted patch
  const patch = await db.query.patches.findFirst({
    where: eq(patches.id, patchId),
  });
  if (!patch) {
    throw new Error(`Patch not found: ${patchId}`);
  }

  // 2. Load patch artifact
  let predictedPatchContent = "";
  if (patch.artifactId) {
    const patchArtifact = await db.query.artifacts.findFirst({
      where: eq(artifacts.id, patch.artifactId),
    });
    if (patchArtifact) {
      predictedPatchContent = await objectStore.getArtifactText(
        patchArtifact.objectKey,
      );
    }
  }

  if (!predictedPatchContent || predictedPatchContent.trim().length === 0) {
    throw new Error(`Patch artifact content not found for patch ${patchId}`);
  }

  // 3. Load gold patch artifact
  const caseVersion = await db.query.caseVersions.findFirst({
    where: eq(caseVersions.id, caseVersionId),
  });
  if (!caseVersion) {
    throw new Error(`Case version not found: ${caseVersionId}`);
  }

  let goldPatchContent = "";
  if (caseVersion.goldPatchArtifactId) {
    const goldArtifact = await db.query.artifacts.findFirst({
      where: eq(artifacts.id, caseVersion.goldPatchArtifactId),
    });
    if (goldArtifact) {
      goldPatchContent = await objectStore.getArtifactText(
        goldArtifact.objectKey,
      );
    }
  }

  if (!goldPatchContent || goldPatchContent.trim().length === 0) {
    throw new Error(
      `Gold patch not found for case version ${caseVersionId}`,
    );
  }

  // 4. Compute diff similarity
  const diffSimilarity = computeJaccardSimilarity(
    predictedPatchContent,
    goldPatchContent,
  );
  const diffSimilarityRounded = Math.round(diffSimilarity * 1_0000) / 1_0000;

  console.log(
    `[grader] computed Jaccard diff similarity: ${diffSimilarityRounded}`,
  );

  // 5. Call OpenRouter
  const { result: scores } =
    await callOpenRouterStructured<ImplementationScoreParsed>(
      { apiKey: openRouterApiKey, modelId: judgeModelId },
      implementationScoreSchema,
      "pilab_implementation_score",
      [
        {
          role: "system",
          content: [
            "You are an expert code reviewer comparing a predicted patch to the gold (correct) patch.",
            "",
            "Score the predicted patch on:",
            "- Overall (1-10): How well does it match the gold patch in intent and correctness?",
            "- Diff Similarity (0-1): How similar are the actual code changes?",
            "",
            "Return ONLY a JSON object with fields: overallScore, diffSimilarityScore, rationale.",
          ].join("\n"),
        },
        {
          role: "user",
          content: [
            "## Predicted Patch",
            "",
            "```diff",
            predictedPatchContent,
            "```",
            "",
            "## Gold Patch (correct fix)",
            "",
            "```diff",
            goldPatchContent,
            "```",
          ].join("\n"),
        },
      ],
      isValidImplementationScore,
    );

  const overallScore = clampScore(Math.round(scores.overallScore), 1, 10);
  const llmSimilarityScore = clampScore(scores.diffSimilarityScore, 0, 1);

  // 6. Update evaluations table
  let evaluationId: string | undefined;

  const existingEvaluation = await db.query.evaluations.findFirst({
    where: eq(evaluations.patchId, patchId),
  });

  if (existingEvaluation) {
    evaluationId = existingEvaluation.id;
    await db
      .update(evaluations)
      .set({
        diffSimilarityScore: String(diffSimilarityRounded),
        status: "passed",
        finishedAt: new Date(),
        rawResults: {
          ...(existingEvaluation.rawResults as Record<string, unknown>),
          grader: {
            overallScore,
            diffSimilarityScore: llmSimilarityScore,
            computedJaccard: diffSimilarityRounded,
            rationale: scores.rationale,
            judgeModelId,
          },
        },
      })
      .where(eq(evaluations.id, existingEvaluation.id));
  } else {
    // Create a minimal evaluation record
    const [created] = await db
      .insert(evaluations)
      .values({
        runId,
        patchId,
        caseVersionId,
        evaluatorVersion: "pilab.grader.v1",
        status: "passed",
        resolved: true,
        diffSimilarityScore: String(diffSimilarityRounded),
        rawResults: {
          grader: {
            overallScore,
            diffSimilarityScore: llmSimilarityScore,
            computedJaccard: diffSimilarityRounded,
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
    `[grader] implementation ${patchId} scored: overall=${overallScore} jaccard=${diffSimilarityRounded}`,
  );

  return {
    implementationScoreId: evaluationId,
    overallScore,
    diffSimilarityScore: diffSimilarityRounded,
    rationale: scores.rationale,
  };
}

// ---------------------------------------------------------------------------
// External comparison processor
// ---------------------------------------------------------------------------

type ExternalVerdictParsed = {
  winner: "A" | "B" | "tie";
  rationale: string;
};

function isValidExternalVerdict(
  value: unknown,
): value is ExternalVerdictParsed {
  if (!isRecord(value)) return false;
  if (
    value.winner !== "A" &&
    value.winner !== "B" &&
    value.winner !== "tie"
  ) {
    return false;
  }
  if (typeof value.rationale !== "string") return false;
  return true;
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

  // 1. Load both runs
  const [runA, runB] = await Promise.all([
    db.query.runs.findFirst({ where: eq(runs.id, runAId) }),
    db.query.runs.findFirst({ where: eq(runs.id, runBId) }),
  ]);

  if (!runA) throw new Error(`Run A not found: ${runAId}`);
  if (!runB) throw new Error(`Run B not found: ${runBId}`);

  // 2. Load patches for both runs
  const [patchesA, patchesB, evalsA, evalsB] = await Promise.all([
    db.query.patches.findMany({
      where: eq(patches.runId, runAId),
    }),
    db.query.patches.findMany({
      where: eq(patches.runId, runBId),
    }),
    db.query.evaluations.findMany({
      where: eq(evaluations.runId, runAId),
    }),
    db.query.evaluations.findMany({
      where: eq(evaluations.runId, runBId),
    }),
  ]);

  // 3. Load patch artifacts
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

  const patchContentA = (
    await Promise.all(patchesA.map(loadPatchContent))
  ).join("\n\n");
  const patchContentB = (
    await Promise.all(patchesB.map(loadPatchContent))
  ).join("\n\n");

  // Build test result summaries
  const summaryA = evalsA[0];
  const summaryB = evalsB[0];

  const testResultA = summaryA
    ? `Status: ${summaryA.status}, Resolved: ${summaryA.resolved}, ` +
      `Fail-to-pass: ${summaryA.failToPassPassed}/${summaryA.failToPassTotal}, ` +
      `Pass-to-pass: ${summaryA.passToPassPassed}/${summaryA.passToPassTotal}`
    : "No evaluation results";

  const testResultB = summaryB
    ? `Status: ${summaryB.status}, Resolved: ${summaryB.resolved}, ` +
      `Fail-to-pass: ${summaryB.failToPassPassed}/${summaryB.failToPassTotal}, ` +
      `Pass-to-pass: ${summaryB.passToPassPassed}/${summaryB.passToPassTotal}`
    : "No evaluation results";

  // 4. Call OpenRouter
  const { result: verdict } =
    await callOpenRouterStructured<ExternalVerdictParsed>(
      { apiKey: openRouterApiKey, modelId: judgeModelId },
      externalVerdictSchema,
      "pilab_external_verdict",
      [
        {
          role: "system",
          content: [
            "You are an impartial judge comparing two coding agent solutions to the same GitHub issue.",
            "",
            "Pick the better solution or declare a tie. Return JSON with: { winner: \"A\" | \"B\" | \"tie\", rationale: string }",
          ].join("\n"),
        },
        {
          role: "user",
          content: [
            "## Agent A Patch",
            "",
            "```diff",
            patchContentA || "(no patch available)",
            "```",
            "",
            "## Agent B Patch",
            "",
            "```diff",
            patchContentB || "(no patch available)",
            "```",
            "",
            "## Test Results",
            `Agent A: ${testResultA}`,
            `Agent B: ${testResultB}`,
          ].join("\n"),
        },
      ],
      isValidExternalVerdict,
    );

  // 5. Map winner to run ID
  let winnerRunId: string | null = null;
  if (verdict.winner === "A") winnerRunId = runAId;
  else if (verdict.winner === "B") winnerRunId = runBId;

  // 6. Insert into grader_verdicts
  const [inserted] = await db
    .insert(graderVerdicts)
    .values({
      experimentId,
      runAId,
      runBId,
      winnerRunId,
      reasoning: verdict.rationale,
      metadata: {
        judgeModelId,
        graderVersion: "pilab.grader.v1",
      },
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

// ---------------------------------------------------------------------------
// Worker creation
// ---------------------------------------------------------------------------

function createPlanProcessor(db: DbClient) {
  return async (job: {
    data: GradingPlanJobData;
  }): Promise<GradingPlanJobResult> => {
    return gradePlan(db, job);
  };
}

function createImplementationProcessor(db: DbClient) {
  return async (job: {
    data: GradingImplementationJobData;
  }): Promise<GradingImplementationJobResult> => {
    return gradeImplementation(db, job);
  };
}

function createExternalProcessor(db: DbClient) {
  return async (job: {
    data: GradingExternalJobData;
  }): Promise<GradingExternalJobResult> => {
    return gradeExternal(db, job);
  };
}

const planWorker = new Worker<GradingPlanJobData, GradingPlanJobResult>(
  GRADING_PLAN_QUEUE_NAME,
  createPlanProcessor(db),
  { connection, concurrency: 1 },
);

const implementationWorker =
  new Worker<GradingImplementationJobData, GradingImplementationJobResult>(
    GRADING_IMPLEMENTATION_QUEUE_NAME,
    createImplementationProcessor(db),
    { connection, concurrency: 1 },
  );

const externalWorker =
  new Worker<GradingExternalJobData, GradingExternalJobResult>(
    GRADING_EXTERNAL_QUEUE_NAME,
    createExternalProcessor(db),
    { connection, concurrency: 1 },
  );

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

function attachEvents<DataType = unknown, ResultType = unknown>(
  worker: Worker<DataType, ResultType>,
  label: string,
): void {
  worker.on("ready", () => {
    console.log(`[grader] ${label} worker ready`);
  });

  worker.on("active", (job) => {
    console.log(
      `[grader] ${label} started job ${job.id ?? "(unknown)"} (${job.name})`,
    );
  });

  worker.on("completed", (job) => {
    console.log(
      `[grader] ${label} completed job ${job.id ?? "(unknown)"}`,
    );
  });

  worker.on("failed", (job, error) => {
    console.error(
      `[grader] ${label} failed job ${job?.id ?? "(unknown)"}: ${error.message}`,
    );
  });

  worker.on("error", (error) => {
    console.error(`[grader] ${label} worker error: ${error.message}`);
  });
}

attachEvents(planWorker, "plan");
attachEvents(implementationWorker, "implementation");
attachEvents(externalWorker, "external");

// ---------------------------------------------------------------------------
// Shutdown
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function readRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
