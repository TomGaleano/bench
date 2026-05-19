import type { FastifyPluginAsync } from "fastify";
import type { ModelSyncReply, ModelSyncRequest } from "../types.js";

type OpenRouterModel = {
  id: string;
  name?: string;
  description?: string;
  created?: number;
  context_length?: number;
  pricing?: {
    prompt?: string;
    completion?: string;
  };
  supported_parameters?: string[];
  architecture?: {
    modality?: string;
    input_modalities?: string[];
  };
};

function pricePerTokenToPerMillion(value: string | undefined) {
  if (value == null || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return parsed * 1_000_000;
}

async function fetchOpenRouterModels(apiKey: string) {
  const response = await fetch("https://openrouter.ai/api/v1/models", {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "X-OpenRouter-Title": "Pi Lab API",
    },
  });

  if (!response.ok) {
    throw new Error(`OpenRouter model sync failed with HTTP ${response.status}`);
  }

  const json = (await response.json()) as { data?: OpenRouterModel[] };
  return Array.isArray(json.data) ? json.data : [];
}

export const modelRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/models", async (_request, reply) => {
    const apiKey = process.env.OPENROUTER_API_KEY;

    if (!apiKey) {
      const error = new Error("OPENROUTER_API_KEY is required") as Error & {
        statusCode: number;
      };
      error.statusCode = 503;
      throw error;
    }

    const snapshots = await fetchOpenRouterModels(apiKey);

    return {
      count: snapshots.length,
      retrievedAt: new Date().toISOString(),
      models: snapshots.map((model) => {
        const supported = new Set(model.supported_parameters ?? []);
        const inputUsdPer1M = pricePerTokenToPerMillion(model.pricing?.prompt);
        const outputUsdPer1M = pricePerTokenToPerMillion(
          model.pricing?.completion,
        );

        const modality =
          model.architecture?.modality ??
          (model.architecture?.input_modalities?.join("+") || undefined);

        return {
          id: model.id,
          name: model.name ?? model.id,
          provider: model.id.split("/")[0] ?? "unknown",
          ...(model.description ? { description: model.description } : {}),
          ...(model.created ? { releasedAt: model.created } : {}),
          ...(modality ? { modality } : {}),
          ...(model.context_length ? { contextWindow: model.context_length } : {}),
          ...(inputUsdPer1M != null ? { inputUsdPer1M } : {}),
          ...(outputUsdPer1M != null ? { outputUsdPer1M } : {}),
          supportsToolCalling:
            supported.has("tools") || supported.has("tool_choice"),
          supportsStructuredOutputs:
            supported.has("response_format") ||
            supported.has("structured_outputs"),
        };
      }),
    };
  });

  fastify.post<{ Body: ModelSyncRequest; Reply: ModelSyncReply }>(
    "/models/sync",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            provider: { type: "string", minLength: 1 },
            modelIds: {
              type: "array",
              items: { type: "string", minLength: 1 },
              uniqueItems: true,
            },
            mode: { type: "string", enum: ["dry-run", "enqueue"] },
          },
        },
      },
    },
    async (request, reply) => {
      const body = request.body ?? {};
      const apiKey = process.env.OPENROUTER_API_KEY;

      if (!apiKey) {
        const error = new Error("OPENROUTER_API_KEY is required for model sync") as Error & {
          statusCode: number;
        };
        error.statusCode = 503;
        throw error;
      }

      const requested = new Set(body.modelIds ?? []);
      const snapshots = await fetchOpenRouterModels(apiKey);
      const filtered =
        requested.size > 0
          ? snapshots.filter((model) => requested.has(model.id))
          : snapshots;

      reply.code(202);

      return {
        accepted: true,
        mode: body.mode ?? "dry-run",
        provider: "openrouter",
        requestedModelIds: body.modelIds ?? [],
        count: filtered.length,
        retrievedAt: new Date().toISOString(),
        models: filtered.slice(0, 50).map((model) => {
          const supported = new Set(model.supported_parameters ?? []);
          const inputUsdPer1M = pricePerTokenToPerMillion(model.pricing?.prompt);
          const outputUsdPer1M = pricePerTokenToPerMillion(
            model.pricing?.completion,
          );

          return {
            id: model.id,
            name: model.name ?? model.id,
            ...(model.context_length ? { contextWindow: model.context_length } : {}),
            ...(inputUsdPer1M != null
              ? { inputUsdPer1M }
              : {}),
            ...(outputUsdPer1M != null
              ? { outputUsdPer1M }
              : {}),
            supportsToolCalling: supported.has("tools"),
            supportsStructuredOutputs:
              supported.has("response_format") ||
              supported.has("structured_outputs"),
          };
        }),
        message:
          body.mode === "enqueue"
            ? "OpenRouter model sync fetched successfully; persistence will be added in the DB-backed sync worker."
            : "OpenRouter model sync dry run completed.",
      };
    },
  );
};
