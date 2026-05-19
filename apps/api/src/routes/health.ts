import type { FastifyPluginAsync } from "fastify";
import type { ApiStatus } from "../types.js";

export const healthRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Reply: { status: ApiStatus; service: string; time: string } }>(
    "/health",
    {
      schema: {
        response: {
          200: {
            type: "object",
            required: ["status", "service", "time"],
            properties: {
              status: { type: "string", const: "ok" },
              service: { type: "string" },
              time: { type: "string" },
            },
          },
        },
      },
    },
    async () => ({
      status: "ok",
      service: "api",
      time: new Date().toISOString(),
    }),
  );
};
