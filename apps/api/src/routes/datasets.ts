import { and, eq, sql } from "drizzle-orm";
import { benchmarkCases, datasets, datasetCases } from "@pilab/db/schema";
import type { FastifyPluginAsync } from "fastify";

export const datasetRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/datasets", async (_request, reply) => {
    const db = fastify.db;

    const rows = await db
      .select({
        id: datasets.id,
        slug: datasets.slug,
        name: datasets.name,
        description: datasets.description,
        status: datasets.status,
        tags: datasets.tags,
        createdAt: datasets.createdAt,
        updatedAt: datasets.updatedAt,
        caseCount: sql<number>`count(${datasetCases.caseId})`.as("case_count"),
      })
      .from(datasets)
      .leftJoin(datasetCases, eq(datasetCases.datasetId, datasets.id))
      .groupBy(datasets.id)
      .orderBy(datasets.createdAt);

    return { datasets: rows };
  });

  fastify.get("/datasets/:slug", async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const db = fastify.db;

    const [dataset] = await db
      .select()
      .from(datasets)
      .where(eq(datasets.slug, slug))
      .limit(1);

    if (!dataset) {
      reply.code(404);
      return { error: "Dataset not found" };
    }

    const cases = await db
      .select({
        id: benchmarkCases.id,
        slug: benchmarkCases.slug,
        title: benchmarkCases.title,
        status: benchmarkCases.status,
        repo: sql<string>`COALESCE(${benchmarkCases.metadata}->'issue'->>'repoOwner', '') || '/' || COALESCE(${benchmarkCases.metadata}->'issue'->>'repoName', '')`
      })
      .from(datasetCases)
      .innerJoin(benchmarkCases, eq(datasetCases.caseId, benchmarkCases.id))
      .where(eq(datasetCases.datasetId, dataset.id))
      .orderBy(datasetCases.orderIndex);

    return { dataset, cases };
  });

  fastify.post("/datasets", async (request, reply) => {
    const body = request.body as {
      slug: string;
      name: string;
      description?: string;
      caseIds?: string[];
    };

    if (!body.slug || !body.name) {
      reply.code(400);
      return { error: "slug and name are required" };
    }

    const db = fastify.db;

    const [existing] = await db
      .select()
      .from(datasets)
      .where(eq(datasets.slug, body.slug))
      .limit(1);

    if (existing) {
      reply.code(409);
      return { error: "Dataset slug already exists" };
    }

    const inserted = await db
      .insert(datasets)
      .values({
        slug: body.slug,
        name: body.name,
        description: body.description,
      })
      .returning();

    const dataset = inserted[0]!;

    if (body.caseIds && body.caseIds.length > 0) {
      await db.insert(datasetCases).values(
        body.caseIds.map((caseId, index) => ({
          datasetId: dataset.id,
          caseId,
          orderIndex: index,
        })),
      );
    }

    reply.code(201);
    return { dataset };
  });

  fastify.delete("/datasets/:slug", async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const db = fastify.db;

    const [dataset] = await db
      .select()
      .from(datasets)
      .where(eq(datasets.slug, slug))
      .limit(1);

    if (!dataset) {
      reply.code(404);
      return { error: "Dataset not found" };
    }

    await db.delete(datasets).where(eq(datasets.id, dataset.id));

    return { deleted: true };
  });

  fastify.post("/datasets/:slug/cases", async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const body = request.body as { caseIds: string[] };

    if (!body.caseIds || !Array.isArray(body.caseIds)) {
      reply.code(400);
      return { error: "caseIds array is required" };
    }

    const db = fastify.db;

    const [dataset] = await db
      .select()
      .from(datasets)
      .where(eq(datasets.slug, slug))
      .limit(1);

    if (!dataset) {
      reply.code(404);
      return { error: "Dataset not found" };
    }

    const existing = await db
      .select({ caseId: datasetCases.caseId })
      .from(datasetCases)
      .where(eq(datasetCases.datasetId, dataset.id));

    const existingIds = new Set(existing.map((r) => r.caseId));
    const newIds = body.caseIds.filter((id) => !existingIds.has(id));

    if (newIds.length > 0) {
      await db.insert(datasetCases).values(
        newIds.map((caseId) => ({
          datasetId: dataset.id,
          caseId,
          orderIndex: 0,
        })),
      );
    }

    return { added: newIds.length };
  });

  fastify.delete("/datasets/:slug/cases/:caseId", async (request, reply) => {
    const { slug, caseId } = request.params as { slug: string; caseId: string };
    const db = fastify.db;

    const [dataset] = await db
      .select()
      .from(datasets)
      .where(eq(datasets.slug, slug))
      .limit(1);

    if (!dataset) {
      reply.code(404);
      return { error: "Dataset not found" };
    }

    await db
      .delete(datasetCases)
      .where(
        and(
          eq(datasetCases.datasetId, dataset.id),
          eq(datasetCases.caseId, caseId),
        ),
      );

    return { removed: true };
  });
};
