import { createDb, type DbClient } from "@pilab/db";
import type { FastifyInstance } from "fastify";

declare module "fastify" {
  interface FastifyInstance {
    db: DbClient;
  }
}

export function registerDb(fastify: FastifyInstance) {
  const connectionString =
    process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:55432/pilab";

  fastify.decorate("db", createDb(connectionString));
}
