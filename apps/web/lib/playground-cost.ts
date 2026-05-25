import type { ModelInfo } from "./api";

const SANDBOX_USD_PER_MINUTE = 0.012;
const AUTOGRADER_USD_FALLBACK = 0.02;

export type CostEstimate = {
  mid: number;
  worstCase: number;
  sandboxUsd: number;
  modelOutputUsd: number;
  autograderUsd: number;
  wallMinutes: number;
  outputTokensPerAgent: number;
};

export type CostEstimateInput = {
  selectedModels: ModelInfo[];
  maxWallClockSeconds: number;
  expectedOutputTokensPerAgent: number;
  autograderModel?: ModelInfo | null;
  runTwiceAndAverage?: boolean;
};

const DEFAULT_INPUT_USD_PER_1M = 5.0;
const DEFAULT_OUTPUT_USD_PER_1M = 15.0;

function priceIn(model: ModelInfo): number {
  return model.inputUsdPer1M ?? DEFAULT_INPUT_USD_PER_1M;
}
function priceOut(model: ModelInfo): number {
  return model.outputUsdPer1M ?? DEFAULT_OUTPUT_USD_PER_1M;
}

export function estimateSessionCost({
  selectedModels,
  maxWallClockSeconds,
  expectedOutputTokensPerAgent,
  autograderModel,
  runTwiceAndAverage,
}: CostEstimateInput): CostEstimate {
  const wallMinutes = Math.max(1, Math.round(maxWallClockSeconds / 60));
  const sandboxUsd = wallMinutes * SANDBOX_USD_PER_MINUTE;

  // Mid estimate assumes agents only use ~60% of the wall-clock budget on
  // average and produce the expected token count. Worst case assumes they
  // burn the whole budget and hit the output cap.
  const runMultiplier = runTwiceAndAverage ? 2 : 1;
  const expectedOutputMillions = (expectedOutputTokensPerAgent / 1_000_000) * runMultiplier;
  const worstCaseOutputMillions = ((expectedOutputTokensPerAgent * 1.5) / 1_000_000) * runMultiplier;
  // Treat input ~= output for mid-estimate (system prompt + tool output is in the same order
  // of magnitude as the model's own output for agent-style tasks).
  const expectedInputMillions = expectedOutputMillions;

  const modelOutputUsd = selectedModels.reduce((sum, m) => {
    return sum + priceOut(m) * expectedOutputMillions + priceIn(m) * expectedInputMillions;
  }, 0);

  const worstCaseModelUsd = selectedModels.reduce((sum, m) => {
    return sum + priceOut(m) * worstCaseOutputMillions + priceIn(m) * worstCaseOutputMillions;
  }, 0);

  const autograderUsd = autograderModel
    ? (priceIn(autograderModel) + priceOut(autograderModel)) * 0.002
    : AUTOGRADER_USD_FALLBACK;

  return {
    mid: sandboxUsd + modelOutputUsd + autograderUsd,
    worstCase: sandboxUsd * 1.2 + worstCaseModelUsd + autograderUsd,
    sandboxUsd,
    modelOutputUsd,
    autograderUsd,
    wallMinutes,
    outputTokensPerAgent: expectedOutputTokensPerAgent,
  };
}

export function formatUsd(amount: number): string {
  if (amount < 0.01) return "<$0.01";
  if (amount < 1) return `$${amount.toFixed(2)}`;
  if (amount < 10) return `$${amount.toFixed(2)}`;
  return `$${amount.toFixed(1)}`;
}
