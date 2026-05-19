import { syncOpenRouterModelSnapshots } from "./index.js";

const apiKey = process.env.OPENROUTER_API_KEY;

if (!apiKey) {
  console.error("OPENROUTER_API_KEY is required.");
  process.exit(1);
}

const snapshots = await syncOpenRouterModelSnapshots({ apiKey });
const preferred = snapshots
  .filter(({ model }) =>
    ["qwen/qwen3.6-flash", "qwen/qwen-2.5-7b-instruct"].includes(
      model.providerModelId,
    ),
  )
  .map(({ model, pricing }) => ({
    id: model.providerModelId,
    name: model.displayName,
    contextWindow: model.contextWindow,
    inputUsdPer1M: pricing.inputUsdPer1M,
    outputUsdPer1M: pricing.outputUsdPer1M,
    supportsToolCalling: model.supportsToolCalling,
    supportsStructuredOutputs: model.supportsStructuredOutputs,
  }));

console.log(
  JSON.stringify(
    {
      count: snapshots.length,
      preferred,
    },
    null,
    2,
  ),
);
