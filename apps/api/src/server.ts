import websocket from "@fastify/websocket";
import Fastify from "fastify";
import { pathToFileURL } from "node:url";
import { registerDb } from "./db.js";
import { createRunEventBus } from "./event-bus.js";
import { datasetRoutes } from "./routes/datasets.js";
import { githubCaseRoutes } from "./routes/github-cases.js";
import { gradingRoutes } from "./routes/grading.js";
import { benchmarkRoutes } from "./routes/benchmarks.js";
import { healthRoutes } from "./routes/health.js";
import { metricsRoutes } from "./routes/metrics.js";
import { modelRoutes } from "./routes/models.js";
import { runRoutes } from "./routes/runs.js";

export function buildServer() {
  const fastify = Fastify({
    logger: true,
  });

  const eventBus = createRunEventBus();

  registerDb(fastify);

  void fastify.register(websocket, {
    options: {
      maxPayload: 1024 * 1024,
    },
  });

  void fastify.register(healthRoutes);
  void fastify.register(modelRoutes);
  void fastify.register(metricsRoutes);
  void fastify.register(benchmarkRoutes);
  void fastify.register(datasetRoutes);
  void fastify.register(githubCaseRoutes);
  void fastify.register(gradingRoutes);
  void fastify.register(runRoutes, { eventBus });

  return fastify;
}

async function start() {
  const server = buildServer();
  const port = Number(process.env.PORT ?? 3001);
  const host = process.env.HOST ?? "0.0.0.0";

  try {
    await server.listen({ port, host });
  } catch (error) {
    server.log.error(error);
    process.exit(1);
  }
}

const entrypointUrl = process.argv[1]
  ? pathToFileURL(process.argv[1]).href
  : undefined;

if (entrypointUrl === import.meta.url) {
  void start();
}
