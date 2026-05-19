import { z } from "zod";

const openRouterModelSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  description: z.string().optional(),
  created: z.number().optional(),
  context_length: z.number().optional(),
  architecture: z.record(z.string(), z.unknown()).optional(),
  pricing: z
    .object({
      prompt: z.string().optional(),
      completion: z.string().optional(),
      request: z.string().optional(),
      image: z.string().optional(),
      web_search: z.string().optional(),
      internal_reasoning: z.string().optional(),
      input_cache_read: z.string().optional(),
      input_cache_write: z.string().optional(),
    })
    .passthrough()
    .optional(),
  supported_parameters: z.array(z.string()).optional(),
  per_request_limits: z.record(z.string(), z.unknown()).optional().nullable(),
});

const openRouterModelsResponseSchema = z.object({
  data: z.array(openRouterModelSchema),
});

export type OpenRouterModel = z.infer<typeof openRouterModelSchema>;

export type NormalizedModelSnapshot = {
  provider: "openrouter";
  providerModelId: string;
  displayName: string;
  description?: string;
  contextWindow?: number;
  createdAtSource?: string;
  supportsToolCalling: boolean;
  supportsStructuredOutputs: boolean;
  supportsStreaming: boolean;
  raw: OpenRouterModel;
};

export type NormalizedPricingSnapshot = {
  provider: "openrouter";
  providerModelId: string;
  source: "openrouter_models_api";
  retrievedAt: string;
  inputUsdPer1M?: number;
  outputUsdPer1M?: number;
  cachedInputUsdPer1M?: number;
  cacheWriteUsdPer1M?: number;
  reasoningUsdPer1M?: number;
  rawPricing?: OpenRouterModel["pricing"];
};

function pricePerTokenToPerMillion(value: string | undefined) {
  if (value == null || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return parsed * 1_000_000;
}

export function normalizeOpenRouterModel(
  model: OpenRouterModel,
  retrievedAt = new Date().toISOString(),
): {
  model: NormalizedModelSnapshot;
  pricing: NormalizedPricingSnapshot;
} {
  const parameters = new Set(model.supported_parameters ?? []);
  const inputUsdPer1M = pricePerTokenToPerMillion(model.pricing?.prompt);
  const outputUsdPer1M = pricePerTokenToPerMillion(model.pricing?.completion);
  const cachedInputUsdPer1M = pricePerTokenToPerMillion(
    model.pricing?.input_cache_read,
  );
  const cacheWriteUsdPer1M = pricePerTokenToPerMillion(
    model.pricing?.input_cache_write,
  );
  const reasoningUsdPer1M = pricePerTokenToPerMillion(
    model.pricing?.internal_reasoning,
  );

  return {
    model: {
      provider: "openrouter",
      providerModelId: model.id,
      displayName: model.name ?? model.id,
      supportsToolCalling: parameters.has("tools"),
      supportsStructuredOutputs:
        parameters.has("response_format") || parameters.has("structured_outputs"),
      supportsStreaming: true,
      raw: model,
      ...(model.description ? { description: model.description } : {}),
      ...(model.context_length ? { contextWindow: model.context_length } : {}),
      ...(model.created
        ? { createdAtSource: new Date(model.created * 1000).toISOString() }
        : {}),
    },
    pricing: {
      provider: "openrouter",
      providerModelId: model.id,
      source: "openrouter_models_api",
      retrievedAt,
      ...(inputUsdPer1M != null ? { inputUsdPer1M } : {}),
      ...(outputUsdPer1M != null ? { outputUsdPer1M } : {}),
      ...(cachedInputUsdPer1M != null ? { cachedInputUsdPer1M } : {}),
      ...(cacheWriteUsdPer1M != null ? { cacheWriteUsdPer1M } : {}),
      ...(reasoningUsdPer1M != null ? { reasoningUsdPer1M } : {}),
      ...(model.pricing ? { rawPricing: model.pricing } : {}),
    },
  };
}

export async function fetchOpenRouterModels(input: {
  apiKey: string;
  fetchImpl?: typeof fetch;
}) {
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl("https://openrouter.ai/api/v1/models", {
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "X-OpenRouter-Title": "Pi Lab Model Sync",
    },
  });

  if (!response.ok) {
    throw new Error(`OpenRouter model sync failed with HTTP ${response.status}`);
  }

  const json = await response.json();
  return openRouterModelsResponseSchema.parse(json).data;
}

export async function syncOpenRouterModelSnapshots(input: {
  apiKey: string;
  fetchImpl?: typeof fetch;
  now?: Date;
}) {
  const retrievedAt = (input.now ?? new Date()).toISOString();
  const models = await fetchOpenRouterModels(input);
  return models.map((model) => normalizeOpenRouterModel(model, retrievedAt));
}
