import { eq } from "drizzle-orm";
import type { DbClient } from "@pilab/db";
import {
  artifacts,
  caseVersions,
  evaluations,
  githubIssues,
  patches,
  plans,
  runEvents,
  runs,
} from "@pilab/db/schema";
import {
  createPiRunnerProgress,
  type PiRunnerPlanJobData,
  type PiRunnerPlanJobResult,
} from "@pilab/jobs";
import type { Job } from "bullmq";
import { cloneRepoAtCommitInRuntime, createBenchmarkRuntime, type RuntimeWorkspace } from "@pilab/runtime";

import {
  ensurePiRunnerOutputDir,
  PiSdkPlanRunner,
  type PiRunner,
  type PiRunnerEvent,
} from "./index.js";
import { createPiRunnerObjectStore } from "./object-store.js";
import {
  type PiRunnerImplStore,
} from "./impl.js";

type JsonRecord = Record<string, unknown>;
type StoredArtifact = Awaited<ReturnType<ReturnType<typeof createPiRunnerObjectStore>["putArtifact"]>>;
type StoredJsonArtifact = Awaited<ReturnType<ReturnType<typeof createPiRunnerObjectStore>["putJsonArtifact"]>>;

type PiRunnerStore = {
  markRunPreparing(runId: string): Promise<void>;
  markRunRunning(runId: string): Promise<void>;
  appendEvent(runId: string, event: PiRunnerEvent): Promise<number>;
  persistPlanResult(input: PersistPlanResultInput): Promise<PersistedPlanResult>;
  markRunFinished(input: MarkRunFinishedInput): Promise<void>;
  loadCaseVersion(caseVersionId: string): Promise<{
    repoOwner: string;
    repoName: string;
    baseCommitSha: string;
    testCommands: string[];
  }>;
};

type PersistPlanResultInput = {
  runId: string;
  caseVersionId: string;
  planMarkdown: string;
  rawSession: unknown[];
};

type PersistedPlanResult = {
  planArtifactId: string;
  planArtifactKey: string;
  rawSessionArtifactId: string;
  rawSessionArtifactKey: string;
};

type MarkRunFinishedInput = {
  runId: string;
  status: "completed" | "failed" | "timeout" | "cancelled";
  errorMessage?: string;
};

export function createPiRunnerPlanProcessor(input: {
  store: PiRunnerStore;
  runner?: PiRunner;
}) {
  const runner = input.runner ?? new PiSdkPlanRunner();

  return async function processPiPlanJob(
    job: Job<PiRunnerPlanJobData, PiRunnerPlanJobResult>,
  ): Promise<PiRunnerPlanJobResult> {
    await job.updateProgress(
      createPiRunnerProgress("loading-run", "Loading run metadata"),
    );
    await input.store.markRunPreparing(job.data.runId);
    await ensurePiRunnerOutputDir(job.data.runId);

    await job.updateProgress(
      createPiRunnerProgress("preparing-workspace", "Preparing plan-only workspace"),
    );

    // Load case version and clone the task repository so the plan agent
    // explores the actual codebase, not the benchmark framework.
    const caseVersion = await input.store.loadCaseVersion(job.data.caseVersionId);
    let runtimeWorkspace: RuntimeWorkspace | undefined;

    await input.store.appendEvent(job.data.runId, {
      stage: "prepare",
      kind: "status",
      payload: { status: "cloning_repo" },
    });
    runtimeWorkspace = await cloneRepoAtCommitInRuntime({
      runtime: createBenchmarkRuntime(),
      workspaceId: `pi-plan-${job.data.runId}`,
      repoUrl: `https://github.com/${caseVersion.repoOwner}/${caseVersion.repoName}.git`,
      commitSha: caseVersion.baseCommitSha,
      timeoutMs: job.data.maxWallClockSeconds * 1000,
      env: { CI: "true" },
    });

    let eventCount = 0;
    await input.store.appendEvent(job.data.runId, {
      stage: "prepare",
      kind: "status",
      payload: { status: "queued", jobId: job.id },
    });
    eventCount += 1;
    await input.store.markRunRunning(job.data.runId);

    await job.updateProgress(
      createPiRunnerProgress("running-pi", "Running Pi plan session"),
    );
    const eventWrites: Promise<number>[] = [];
    const result = await runner.run(
      {
        runId: job.data.runId,
        mode: "plan",
        workspacePath: runtimeWorkspace.rootPath,
        runtimeWorkspace,
        modelId: job.data.modelId,
        prompt: job.data.prompt,
        maxTurns: job.data.maxTurns,
        maxWallClockSeconds: job.data.maxWallClockSeconds,
      },
      (event) => {
        eventCount += 1;
        eventWrites.push(input.store.appendEvent(job.data.runId, event));
      },
    );
    await Promise.all(eventWrites);

    await job.updateProgress(
      createPiRunnerProgress("persisting-artifacts", "Persisting plan artifacts"),
    );
    const persisted = await input.store.persistPlanResult({
      runId: job.data.runId,
      caseVersionId: job.data.caseVersionId,
      planMarkdown: result.planMarkdown ?? "",
      rawSession: result.rawSession ?? [],
    });

    await input.store.appendEvent(job.data.runId, {
      stage: "plan",
      kind: "artifact_created",
      payload: {
        kind: "plan",
        objectKey: persisted.planArtifactKey,
      },
    });
    eventCount += 1;
    await input.store.appendEvent(job.data.runId, {
      stage: "plan",
      kind: "artifact_created",
      payload: {
        kind: "session_log",
        objectKey: persisted.rawSessionArtifactKey,
      },
    });
    eventCount += 1;

    await input.store.markRunFinished({
      runId: job.data.runId,
      status: result.status,
      ...(result.errorMessage ? { errorMessage: result.errorMessage } : {}),
    });

    await job.updateProgress(
      createPiRunnerProgress(
        result.status === "completed" ? "completed" : "failed",
        result.status === "completed" ? "Pi plan run completed" : "Pi plan run failed",
      ),
    );

    const response = {
      runId: job.data.runId,
      caseVersionId: job.data.caseVersionId,
      status: result.status,
      planArtifactId: persisted.planArtifactId,
      planArtifactKey: persisted.planArtifactKey,
      rawSessionArtifactId: persisted.rawSessionArtifactId,
      rawSessionArtifactKey: persisted.rawSessionArtifactKey,
      eventCount,
      completedAt: new Date().toISOString(),
      ...(result.errorMessage ? { errorMessage: result.errorMessage } : {}),
    };
    await runtimeWorkspace.delete().catch(() => undefined);
    return response;
  };
}

export type FullPiRunnerStore = PiRunnerStore & PiRunnerImplStore;

export function createDrizzlePiRunnerStore(
  db: DbClient,
): FullPiRunnerStore {
  const objectStore = createPiRunnerObjectStore();
  const seqByRunId = new Map<string, number>();

  async function nextSeq(runId: string): Promise<number> {
    const current = seqByRunId.get(runId);
    if (current !== undefined) {
      const next = current + 1;
      seqByRunId.set(runId, next);
      return next;
    }

    const rows = await db.query.runEvents.findMany({
      where: eq(runEvents.runId, runId),
      columns: { seq: true },
    });
    const max = rows.reduce((value, row) => Math.max(value, row.seq), 0);
    const next = max + 1;
    seqByRunId.set(runId, next);
    return next;
  }

  async function insertArtifact(
    kind: string,
    stored: StoredArtifact | StoredJsonArtifact,
    metadata: JsonRecord,
  ) {
    const [row] = await db
      .insert(artifacts)
      .values({
        kind: kind as typeof artifacts.$inferInsert["kind"],
        storageProvider: "s3",
        bucket: stored.bucket,
        objectKey: stored.key,
        sha256: stored.sha256,
        byteSize: stored.sizeBytes,
        contentType: stored.contentType,
        metadata,
      })
      .returning();

    if (!row) {
      throw new Error(`Failed to persist ${kind} artifact metadata`);
    }

    return row;
  }

  return {
    // ── PiRunnerStore ──────────────────────────────────────────
    async markRunPreparing(runId) {
      await db
        .update(runs)
        .set({ status: "preparing", startedAt: new Date() })
        .where(eq(runs.id, runId));
    },
    async markRunRunning(runId) {
      await db.update(runs).set({ status: "running" }).where(eq(runs.id, runId));
    },
    async appendEvent(runId, event) {
      const seq = await nextSeq(runId);
      await db.insert(runEvents).values({
        runId,
        seq,
        stage: event.stage,
        kind: event.kind,
        payload: toJsonRecord(event.payload),
      });
      return seq;
    },
    async persistPlanResult({ runId, caseVersionId, planMarkdown, rawSession }) {
      await objectStore.ensureBucket();
      const prefix = `runs/${runId}/pi-plan`;
      const planArtifact = await objectStore.putArtifact({
        key: `${prefix}/plan.md`,
        body: planMarkdown || "# Empty Plan\n",
        contentType: "text/markdown; charset=utf-8",
        metadata: { runId, caseVersionId },
      });
      const rawSessionArtifact = await objectStore.putJsonArtifact({
        key: `${prefix}/session-log.json`,
        value: toJsonValue({
          runId,
          caseVersionId,
          events: rawSession,
        }),
        metadata: { runId, caseVersionId },
      });
      const planRow = await insertArtifact("plan", planArtifact, {
        runId,
        caseVersionId,
      });
      const rawSessionRow = await insertArtifact(
        "session_log",
        rawSessionArtifact,
        { runId, caseVersionId },
      );

      await db.insert(plans).values({
        runId,
        caseVersionId,
        rawArtifactId: planRow.id,
        formatVersion: "pilab.plan-markdown.v1",
        planMarkdown,
        planJson: {},
      });

      return {
        planArtifactId: planRow.id,
        planArtifactKey: planRow.objectKey,
        rawSessionArtifactId: rawSessionRow.id,
        rawSessionArtifactKey: rawSessionRow.objectKey,
      };
    },
    async markRunFinished({ runId, status, errorMessage }) {
      const dbStatus = toDbRunStatus(status);
      await db
        .update(runs)
        .set({
          status: dbStatus,
          finishedAt: new Date(),
          ...(errorMessage ? { error: { message: errorMessage } } : {}),
        })
        .where(eq(runs.id, runId));
    },

    // ── PiRunnerImplStore ──────────────────────────────────────
    async loadPlan(planRunId) {
      const maxWaitMs = 5 * 60 * 1000; // 5 minutes
      const pollIntervalMs = 5000; // 5 seconds
      const startTime = Date.now();

      while (true) {
        const elapsed = Date.now() - startTime;

        // Check plan run status
        const [planRun] = await db
          .select({ status: runs.status, error: runs.error })
          .from(runs)
          .where(eq(runs.id, planRunId))
          .limit(1);

        if (planRun && (planRun.status === "failed" || planRun.status === "cancelled" || planRun.status === "timed_out")) {
          throw new Error(
            `Plan run ${planRunId} ${planRun.status}. Cannot proceed with implementation.`,
          );
        }

        // Check plan artifact
        const planRows = await db.query.plans.findMany({
          where: eq(plans.runId, planRunId),
          columns: { planMarkdown: true },
        });

        const planMarkdown =
          planRows.find((row) => row.planMarkdown)?.planMarkdown ?? "";

        if (planRun && planRun.status === "succeeded" && planMarkdown) {
          return { planMarkdown };
        }

        // Timed out?
        if (elapsed >= maxWaitMs) {
          throw new Error(
            `Timed out waiting for plan ${planRunId} to be ready after ${Math.round(elapsed / 1000)}s. Plan status: ${planRun?.status ?? "unknown"}`,
          );
        }

        console.log(
          `Waiting for plan ${planRunId} to be ready... (${Math.round(elapsed / 1000)}s elapsed, status: ${planRun?.status ?? "unknown"})`,
        );
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      }
    },

    async loadCaseVersion(caseVersionId) {
      const row = await db.query.caseVersions.findFirst({
        where: eq(caseVersions.id, caseVersionId),
        columns: {
          repoOwner: true,
          repoName: true,
          baseCommitSha: true,
          testCommands: true,
        },
      });

      if (!row) {
        throw new Error(`Case version ${caseVersionId} not found`);
      }

      return {
        repoOwner: row.repoOwner,
        repoName: row.repoName,
        baseCommitSha: row.baseCommitSha,
        testCommands: (row.testCommands as string[]) ?? [],
      };
    },

    async loadIssueContent(caseVersionId) {
      const [cv] = await db
        .select({
          githubIssueId: caseVersions.githubIssueId,
        })
        .from(caseVersions)
        .where(eq(caseVersions.id, caseVersionId))
        .limit(1);

      if (!cv?.githubIssueId) {
        return { issueTitle: "", issueBody: "" };
      }

      const [issue] = await db
        .select({ title: githubIssues.title, body: githubIssues.body })
        .from(githubIssues)
        .where(eq(githubIssues.id, cv.githubIssueId))
        .limit(1);

      return {
        issueTitle: issue?.title ?? "",
        issueBody: issue?.body ?? "",
      };
    },

    async persistImplResult({
      runId,
      caseVersionId,
      patchDiff,
      rawSession,
      testResults,
    }) {
      await objectStore.ensureBucket();
      const prefix = `runs/${runId}/pi-impl`;

      // Store patch artifact
      const patchArtifact = await objectStore.putArtifact({
        key: `${prefix}/patch.diff`,
        body: patchDiff || "# No changes\n",
        contentType: "text/x-diff; charset=utf-8",
        metadata: { runId, caseVersionId },
      });

      // Store raw session artifact
      const rawSessionArtifact = await objectStore.putJsonArtifact({
        key: `${prefix}/session-log.json`,
        value: toJsonValue({
          runId,
          caseVersionId,
          events: rawSession,
        }),
        metadata: { runId, caseVersionId },
      });

      const patchRow = await insertArtifact(
        "predicted_patch",
        patchArtifact,
        { runId, caseVersionId },
      );
      const rawSessionRow = await insertArtifact(
        "session_log",
        rawSessionArtifact,
        { runId, caseVersionId },
      );

      // Insert into patches table
      const [patch] = await db
        .insert(patches)
        .values({
          runId,
          caseVersionId,
          artifactId: patchRow.id,
          kind: "predicted",
          summary: `Patch generated by Pi impl runner for run ${runId}`,
          stats: {},
        })
        .returning();

      if (!patch) {
        throw new Error("Failed to insert patch record");
      }

      // Compute evaluation stats
      const passed = testResults.filter((r) => r.passed).length;
      const total = testResults.length;
      const resolved = total > 0 && passed === total;

      // Insert into evaluations table
      const [evaluation] = await db
        .insert(evaluations)
        .values({
          runId,
          patchId: patch.id,
          caseVersionId,
          evaluatorVersion: "pi-impl-v1",
          status: resolved ? "passed" : "failed",
          resolved,
          failToPassPassed: passed,
          failToPassTotal: total,
          passToPassPassed: 0,
          passToPassTotal: 0,
          rawResults: toJsonValue({ testResults }),
          startedAt: new Date(),
          finishedAt: new Date(),
        })
        .returning();

      if (!evaluation) {
        throw new Error("Failed to insert evaluation record");
      }

      return {
        patchArtifactId: patchRow.id,
        patchArtifactKey: patchRow.objectKey,
        rawSessionArtifactId: rawSessionRow.id,
        rawSessionArtifactKey: rawSessionRow.objectKey,
        evaluationId: evaluation.id,
        resolved,
      };
    },
  };
}

function toDbRunStatus(status: MarkRunFinishedInput["status"]) {
  if (status === "completed") {
    return "succeeded" as const;
  }

  if (status === "timeout") {
    return "timed_out" as const;
  }

  return status === "cancelled" ? "cancelled" : "failed";
}

function toJsonRecord(value: unknown): JsonRecord {
  return JSON.parse(JSON.stringify(value ?? {})) as JsonRecord;
}

function toJsonValue(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as never;
}
