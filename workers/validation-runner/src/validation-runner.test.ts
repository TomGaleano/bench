import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Artifact } from "@pilab/db";
import {
  buildTestPatchCommand,
  createValidationRunnerProcessor,
  detectTestRunner,
  type GitCommandExecutor,
  type ValidationRunnerAttempt,
  type ValidationRunnerCaseVersion,
  type ValidationRunnerStore,
  type ValidationRunnerTestSpec,
} from "./validation-runner.js";

describe("createValidationRunnerProcessor", () => {
  it("rejects proposed tests that cannot be materialized or executed", async () => {
    const attempt = createAttempt();
    const caseVersion = createCaseVersion();
    const test = createTestSpec({
      filePath: null,
      testCommand: "it('is a test body, not a shell command', () => {})",
      content: "it('is missing a file path', () => {})",
    });
    const store = createMemoryStore({ attempt, caseVersion, tests: [test] });
    const progress: unknown[] = [];

    const result = await createValidationRunnerProcessor({
      store,
      executor: createPassingExecutor(),
      runnerVersion: "test-runner",
    })({
      data: {
        caseVersionId: caseVersion.id,
        validationAttemptId: attempt.id,
        candidateTestsArtifactId: "artifact-1",
        enqueuedAt: "2026-05-02T00:00:00.000Z",
      },
      async updateProgress(next) {
        progress.push(next);
      },
    });

    assert.equal(result.status, "rejected");
    assert.equal(result.acceptedTestCount, 0);
    assert.equal(result.rejectedTestCount, 1);
    assert.equal(store.finished?.status, "rejected");
    assert.deepEqual(store.finished?.rejectedTestIds, [test.id]);
    assert.equal(store.testStatuses.get(test.id), "rejected");
    assert.equal(progress.some((item) => isStage(item, "checking-repository-refs")), true);
  });

  it("accepts a fail_to_pass test only when base fails and gold passes", async () => {
    const attempt = createAttempt();
    const caseVersion = createCaseVersion();
    const test = createTestSpec({
      kind: "fail_to_pass",
      filePath: "src/example.test.ts",
      testCommand: "pnpm test src/example.test.ts",
      content: "test('example', () => expect(true).toBe(true));",
    });
    const store = createMemoryStore({ attempt, caseVersion, tests: [test] });
    const executor = createPassingExecutor({
      shellResults: [
        { exitCode: 1, stdout: "", stderr: "base failed", timedOut: false },
        { exitCode: 0, stdout: "gold passed", stderr: "", timedOut: false },
      ],
    });

    const result = await createValidationRunnerProcessor({
      store,
      executor,
      runnerVersion: "test-runner",
    })({
      data: {
        caseVersionId: caseVersion.id,
        validationAttemptId: attempt.id,
        candidateTestsArtifactId: "artifact-1",
        enqueuedAt: "2026-05-02T00:00:00.000Z",
      },
      async updateProgress() {},
    });

    assert.equal(result.status, "accepted");
    assert.equal(result.acceptedTestCount, 1);
    assert.equal(result.rejectedTestCount, 0);
    assert.equal(store.testStatuses.get(test.id), "accepted");
  });

  it("persists validation, base, and gold log artifacts when object storage is configured", async () => {
    const attempt = createAttempt();
    const caseVersion = createCaseVersion();
    const test = createTestSpec({
      kind: "fail_to_pass",
      filePath: "src/example.test.ts",
      testCommand: "pnpm test src/example.test.ts",
      content: "test('example', () => expect(true).toBe(true));",
    });
    const store = createMemoryStore({ attempt, caseVersion, tests: [test] });
    const objectStore = createMemoryObjectStore();
    const executor = createPassingExecutor({
      shellResults: [
        { exitCode: 1, stdout: "base failed", stderr: "", timedOut: false },
        { exitCode: 0, stdout: "gold passed", stderr: "", timedOut: false },
      ],
    });

    const result = await createValidationRunnerProcessor({
      store,
      objectStore,
      executor,
      runnerVersion: "test-runner",
    })({
      data: {
        caseVersionId: caseVersion.id,
        validationAttemptId: attempt.id,
        candidateTestsArtifactId: "artifact-1",
        enqueuedAt: "2026-05-02T00:00:00.000Z",
      },
      async updateProgress() {},
    });

    assert.equal(result.status, "accepted");
    assert.equal(objectStore.puts.length, 3);
    assert.equal(store.finished?.validationLogArtifactId, "validation-artifact-1");
    assert.equal(store.finished?.baseLogArtifactId, "validation-artifact-2");
    assert.equal(store.finished?.goldLogArtifactId, "validation-artifact-3");
  });

  it("accepts PR test patch when tests fail on base and pass on gold", async () => {
    const attempt = createAttempt();
    const testPatchArtifact = {
      id: "test-patch-artifact-1",
      kind: "test_patch" as const,
      storageProvider: "s3" as const,
      bucket: "pilab-artifacts",
      objectKey: "test-patch.json",
      sha256: "0".repeat(64),
      byteSize: 100,
      contentType: "application/json",
      metadata: {},
      createdAt: new Date("2026-05-02T00:00:00.000Z"),
    };
    const caseVersion = createCaseVersion({
      metadata: { testPatchArtifactId: testPatchArtifact.id },
    });
    const store = createMemoryStore({
      attempt,
      caseVersion,
      tests: [],
      artifacts: { [testPatchArtifact.id]: testPatchArtifact },
    });
    const objectStore = createMemoryObjectStore({
      artifacts: {
        "test-patch.json": {
          testPatch: "diff --git a/tests/test_example.py b/tests/test_example.py\n...",
          testFiles: ["tests/test_example.py"],
        },
      },
    });
    const executor = createPassingExecutor({
      shellResults: [
        { exitCode: 0, stdout: "", stderr: "", timedOut: false },
        { exitCode: 0, stdout: "", stderr: "", timedOut: false },
        {
          exitCode: 1,
          stdout: "tests/test_example.py::test_bug FAILED\ntests/test_example.py::test_guard PASSED\n",
          stderr: "",
          timedOut: false,
        },
        {
          exitCode: 0,
          stdout: "tests/test_example.py::test_bug PASSED\ntests/test_example.py::test_guard PASSED\n",
          stderr: "",
          timedOut: false,
        },
      ],
    });

    const result = await createValidationRunnerProcessor({
      store,
      objectStore,
      executor,
      runnerVersion: "test-runner",
    })({
      data: {
        caseVersionId: caseVersion.id,
        validationAttemptId: attempt.id,
        candidateTestsArtifactId: "artifact-1",
        enqueuedAt: "2026-05-02T00:00:00.000Z",
      },
      async updateProgress() {},
    });

    assert.equal(result.status, "accepted");
    assert.deepEqual(result.failToPassTests, ["tests/test_example.py::test_bug"]);
    assert.deepEqual(result.passToPassTests, ["tests/test_example.py::test_guard"]);
  });

  it("rejects PR test patch when no tests fail on base", async () => {
    const attempt = createAttempt();
    const testPatchArtifact = {
      id: "test-patch-artifact-1",
      kind: "test_patch" as const,
      storageProvider: "s3" as const,
      bucket: "pilab-artifacts",
      objectKey: "test-patch.json",
      sha256: "0".repeat(64),
      byteSize: 100,
      contentType: "application/json",
      metadata: {},
      createdAt: new Date("2026-05-02T00:00:00.000Z"),
    };
    const caseVersion = createCaseVersion({
      metadata: { testPatchArtifactId: testPatchArtifact.id },
    });
    const store = createMemoryStore({
      attempt,
      caseVersion,
      tests: [],
      artifacts: { [testPatchArtifact.id]: testPatchArtifact },
    });
    const objectStore = createMemoryObjectStore({
      artifacts: {
        "test-patch.json": {
          testPatch: "diff...",
          testFiles: ["tests/test_example.py"],
        },
      },
    });
    const executor = createPassingExecutor({
      shellResults: [
        { exitCode: 0, stdout: "", stderr: "", timedOut: false },
        { exitCode: 0, stdout: "", stderr: "", timedOut: false },
        {
          exitCode: 0,
          stdout: "tests/test_example.py::test_bug PASSED\n",
          stderr: "",
          timedOut: false,
        },
        {
          exitCode: 0,
          stdout: "tests/test_example.py::test_bug PASSED\n",
          stderr: "",
          timedOut: false,
        },
      ],
    });

    const result = await createValidationRunnerProcessor({
      store,
      objectStore,
      executor,
      runnerVersion: "test-runner",
    })({
      data: {
        caseVersionId: caseVersion.id,
        validationAttemptId: attempt.id,
        candidateTestsArtifactId: "artifact-1",
        enqueuedAt: "2026-05-02T00:00:00.000Z",
      },
      async updateProgress() {},
    });

    assert.equal(result.status, "rejected");
    assert.deepEqual(result.failToPassTests, []);
  });

});

describe("detectTestRunner", () => {
  it("returns vitest when package.json contains vitest in devDependencies", async () => {
    const result = await detectTestRunner("/fake/path", async () =>
      JSON.stringify({ devDependencies: { vitest: "^1.0.0" } }),
    );
    assert.deepEqual(result, { name: "vitest", command: "npx vitest run" });
  });

  it("returns jest when package.json contains jest in dependencies", async () => {
    const result = await detectTestRunner("/fake/path", async () =>
      JSON.stringify({ dependencies: { jest: "^29.0.0" } }),
    );
    assert.deepEqual(result, { name: "jest", command: "npx jest" });
  });

  it("returns null when no test runner is found", async () => {
    const result = await detectTestRunner("/fake/path", async () =>
      JSON.stringify({ dependencies: { react: "^18.0.0" } }),
    );
    assert.equal(result, null);
  });
});

describe("buildTestPatchCommand", () => {
  it("defaults to npx jest when no test commands and no runner detected", async () => {
    const result = await buildTestPatchCommand(
      ["src/test.ts"],
      [],
      "/fake/path",
      async () => JSON.stringify({}),
    );
    assert.equal(result, "npx jest --verbose src/test.ts");
  });

  it("uses detected vitest runner when testCommands is empty and files are ts", async () => {
    const result = await buildTestPatchCommand(
      ["src/test.ts"],
      [],
      "/fake/path",
      async () => JSON.stringify({ devDependencies: { vitest: "^1.0.0" } }),
    );
    assert.equal(result, "npx vitest run src/test.ts");
  });

  it("uses pytest for py files regardless of package.json", async () => {
    const result = await buildTestPatchCommand(
      ["tests/test_example.py"],
      [],
      "/fake/path",
    );
    assert.equal(result, "pytest -v tests/test_example.py");
  });

  it("uses first test command when provided", async () => {
    const result = await buildTestPatchCommand(
      ["src/test.ts"],
      ["jest --verbose"],
      "/fake/path",
    );
    assert.equal(result, "jest --verbose src/test.ts");
  });
});

function createMemoryStore(input: {
  attempt: ValidationRunnerAttempt;
  caseVersion: ValidationRunnerCaseVersion;
  tests: ValidationRunnerTestSpec[];
  artifacts?: Record<string, Artifact>;
}): ValidationRunnerStore & {
  finished?: Parameters<ValidationRunnerStore["finishAttempt"]>[0];
  testStatuses: Map<string, "accepted" | "rejected">;
} {
  const testStatuses = new Map<string, "accepted" | "rejected">();
  let validationArtifactCount = 0;
  const artifacts = input.artifacts ?? {};

  return {
    testStatuses,
    async findAttemptById(id) {
      return id === input.attempt.id ? input.attempt : undefined;
    },
    async findCaseVersionById(id) {
      return id === input.caseVersion.id ? input.caseVersion : undefined;
    },
    async findArtifactById(id) {
      if (id === "artifact-1") {
        return {
          id,
          kind: "raw_json",
          storageProvider: "s3",
          bucket: "pilab-artifacts",
          objectKey: "candidate-tests.json",
          sha256: "0".repeat(64),
          byteSize: 42,
          contentType: "application/json",
          metadata: {},
          createdAt: new Date("2026-05-02T00:00:00.000Z"),
        };
      }
      return artifacts[id] ?? undefined;
    },
    async findProposedTestSpecs(validationAttemptId) {
      return validationAttemptId === input.attempt.id ? input.tests : [];
    },
    async markAttemptRunning() {},
    async finishAttempt(next) {
      this.finished = next;
      next.acceptedTestIds.forEach((id) => testStatuses.set(id, "accepted"));
      next.rejectedTestIds.forEach((id) => testStatuses.set(id, "rejected"));
    },
    async createValidationLogArtifact(input) {
      validationArtifactCount += 1;
      return {
        id: `validation-artifact-${validationArtifactCount}`,
        kind: "validation_log",
        storageProvider: "s3",
        bucket: input.stored.bucket,
        objectKey: input.stored.key,
        sha256: input.stored.sha256,
        byteSize: input.stored.sizeBytes,
        contentType: input.stored.contentType,
        metadata: input.metadata,
        createdAt: new Date("2026-05-02T00:00:00.000Z"),
      };
    },
  };
}

function createMemoryObjectStore(input?: {
  artifacts?: Record<string, unknown>;
}) {
  const puts: Array<{ key: string; value: unknown }> = [];
  const artifacts = input?.artifacts ?? {};

  return {
    puts,
    async ensureBucket() {},
    async putJsonArtifact(input: {
      key: string;
      value: unknown;
      metadata?: Record<string, string>;
    }) {
      puts.push({ key: input.key, value: input.value });
      return {
        key: input.key,
        bucket: "pilab-artifacts",
        sha256: `${puts.length}`.padStart(64, "0"),
        sizeBytes: JSON.stringify(input.value).length,
        contentType: "application/json",
      };
    },
    async getJsonArtifact<T>(key: string): Promise<T> {
      const value = artifacts[key];
      if (value === undefined) {
        throw new Error(`Artifact not found in memory object store: ${key}`);
      }
      return value as T;
    },
  };
}

function createPassingExecutor(input: {
  shellResults?: Array<{
    exitCode: number;
    stdout: string;
    stderr: string;
    timedOut: boolean;
  }>;
} = {}): GitCommandExecutor {
  const shellResults = [...(input.shellResults ?? [])];

  return {
    async fetchCommit() {
      return [{ exitCode: 0, stdout: "", stderr: "", timedOut: false }];
    },
    async runShell() {
      return shellResults.shift() ?? {
        exitCode: 0,
        stdout: "",
        stderr: "",
        timedOut: false,
      };
    },
  };
}

function createAttempt(): ValidationRunnerAttempt {
  return {
    id: "attempt-1",
    caseVersionId: "case-version-1",
    candidateTestsArtifactId: "artifact-1",
    baseLogArtifactId: null,
    goldLogArtifactId: null,
    runnerVersion: "pending",
    status: "queued",
    attemptNumber: 1,
    strategy: "unit_tests",
    previousAttemptId: null,
    acceptedTestCount: 0,
    rejectedTestCount: 0,
    rawResults: {},
    createdAt: new Date("2026-05-02T00:00:00.000Z"),
    startedAt: null,
    finishedAt: null,
  };
}

function createCaseVersion(
  overrides?: Partial<ValidationRunnerCaseVersion>,
): ValidationRunnerCaseVersion {
  return {
    id: "case-version-1",
    caseId: "case-1",
    version: 1,
    status: "candidate",
    githubIssueId: "issue-1",
    githubPullRequestId: "pr-1",
    issueArtifactId: "issue-artifact-1",
    pullRequestArtifactId: "pr-artifact-1",
    repositoryMetadataArtifactId: "repo-artifact-1",
    goldPatchArtifactId: null,
    testPatchArtifactId: null,
    validationLogArtifactId: null,
    repoOwner: "facebook",
    repoName: "react",
    baseCommitSha: "a".repeat(40),
    goldCommitSha: "b".repeat(40),
    environmentRecipe: {},
    setupCommands: [],
    testCommands: [],
    promptVersions: {},
    testBuilderModelId: "qwen/test",
    validationRunnerVersion: null,
    evaluatorStrategy: null,
    metadata: {},
    createdAt: new Date("2026-05-02T00:00:00.000Z"),
    frozenAt: null,
    ...overrides,
  };
}

function createTestSpec(
  overrides: Partial<ValidationRunnerTestSpec>,
): ValidationRunnerTestSpec {
  return {
    id: "test-1",
    caseVersionId: "case-version-1",
    validationAttemptId: "attempt-1",
    name: "example",
    kind: "pass_to_pass",
    status: "proposed",
    filePath: "src/example.test.ts",
    testCommand: "pnpm test",
    expectedFailureMode: null,
    expectedPassMode: null,
    content: "test('example', () => {})",
    metadata: {},
    createdAt: new Date("2026-05-02T00:00:00.000Z"),
    ...overrides,
  };
}

function isStage(value: unknown, stage: string): boolean {
  return typeof value === "object" &&
    value !== null &&
    "stage" in value &&
    value.stage === stage;
}
