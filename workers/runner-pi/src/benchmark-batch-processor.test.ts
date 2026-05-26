import { test } from "node:test";
import assert from "node:assert/strict";

// We re-implement parseEvaluatorOutput here against the public contract because
// the function is intentionally module-private; this test pins the JSON shape
// the Pi evaluator must produce.

type AgentPlan = {
  spec: { runId: string; modelId: string; modelName: string };
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

// Mirror of parseEvaluatorOutput in benchmark-batch-processor.ts.
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

const plans: AgentPlan[] = [
  { spec: { runId: "r0", modelId: "m0", modelName: "gpt" }, index: 0, branch: "agent-0", worktreePath: "/wt0" },
  { spec: { runId: "r1", modelId: "m1", modelName: "claude" }, index: 1, branch: "agent-1", worktreePath: "/wt1" },
];

test("parses a well-formed scores array", () => {
  const result = parseEvaluatorOutput(
    {
      scores: [
        { agentIndex: 0, branch: "agent-0", overall: 87, correctness: 5, codeQuality: 4, ux: 3, shipIt: 4, rationale: "ok" },
        { agentIndex: 1, branch: "agent-1", overall: 42, correctness: 2, codeQuality: 3, ux: 3, shipIt: 2 },
      ],
    },
    plans,
  );
  assert.equal(result.length, 2);
  assert.equal(result[0]!.overall, 87);
  assert.equal(result[0]!.correctness, 5);
  assert.equal(result[0]!.rationale, "ok");
  assert.equal(result[1]!.overall, 42);
  assert.equal(result[1]!.rationale, undefined);
});

test("defaults branch from agentPlans when missing", () => {
  const result = parseEvaluatorOutput(
    { scores: [{ agentIndex: 1, overall: 50 }] },
    plans,
  );
  assert.equal(result[0]!.branch, "agent-1");
});

test("clamps overall to 0-100 and sub-scores to 1-5", () => {
  const result = parseEvaluatorOutput(
    {
      scores: [
        { agentIndex: 0, overall: 250, correctness: 9, codeQuality: -1, ux: 0, shipIt: 6 },
      ],
    },
    plans,
  );
  assert.equal(result[0]!.overall, 100);
  assert.equal(result[0]!.correctness, 5);
  assert.equal(result[0]!.codeQuality, 1);
  assert.equal(result[0]!.ux, 1);
  assert.equal(result[0]!.shipIt, 5);
});

test("skips entries with out-of-range agentIndex", () => {
  const result = parseEvaluatorOutput(
    {
      scores: [
        { agentIndex: 0, overall: 80 },
        { agentIndex: 5, overall: 80 },
        { agentIndex: -1, overall: 80 },
      ],
    },
    plans,
  );
  assert.equal(result.length, 1);
});

test("throws when scores array is missing", () => {
  assert.throws(() => parseEvaluatorOutput({}, plans), /scores/);
});

test("throws when no usable entries remain", () => {
  assert.throws(
    () => parseEvaluatorOutput({ scores: [{ agentIndex: 99, overall: 50 }] }, plans),
    /no usable scores/,
  );
});
