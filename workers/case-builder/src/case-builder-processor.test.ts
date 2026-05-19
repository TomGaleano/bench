import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { artifacts, caseVersions } from "@pilab/db";
import type { CaseBuilderPrepareJobData } from "@pilab/jobs";

import {
  createCaseBuilderPrepareProcessor,
  type CaseBuilderPrepareJobLike,
  type CaseBuilderPreflightStore,
} from "./case-builder-processor.js";

type CaseVersionRow = typeof caseVersions.$inferSelect;
type ArtifactRow = typeof artifacts.$inferSelect;

describe("createCaseBuilderPrepareProcessor", () => {
  it("preflights linked case version data and completes ready for test builder", async () => {
    const data = createJobData();
    const progressStages: string[] = [];
    const processor = createCaseBuilderPrepareProcessor({
      store: createStore({
        caseVersion: createCaseVersion(data),
        artifacts: [
          createArtifact(data.artifactIds.issue),
          createArtifact(data.artifactIds.pullRequest),
          createArtifact(data.artifactIds.repositoryMetadata),
        ],
      }),
    });

    const result = await processor(createJob(data, progressStages));

    assert.equal(result.caseId, data.caseId);
    assert.equal(result.caseVersionId, data.caseVersionId);
    assert.equal(result.stage, "ready-for-test-builder");
    assert.equal(result.verifiedArtifactCount, 3);
    assert.ok(Date.parse(result.completedAt));
    assert.deepEqual(progressStages, [
      "loading-case-version",
      "validating-artifacts",
      "ready-for-test-builder",
    ]);
  });

  it("fails when a required artifact is missing", async () => {
    const data = createJobData();
    const progressStages: string[] = [];
    const processor = createCaseBuilderPrepareProcessor({
      store: createStore({
        caseVersion: createCaseVersion(data),
        artifacts: [
          createArtifact(data.artifactIds.issue),
          createArtifact(data.artifactIds.pullRequest),
        ],
      }),
    });

    await assert.rejects(
      processor(createJob(data, progressStages)),
      /Artifacts not found:/,
    );
    assert.deepEqual(progressStages, [
      "loading-case-version",
      "validating-artifacts",
      "failed",
    ]);
  });
});

function createJobData(): CaseBuilderPrepareJobData {
  return {
    caseId: "case-1",
    caseVersionId: "case-version-1",
    githubIssueId: "issue-1",
    githubPullRequestId: "pr-1",
    artifactIds: {
      issue: "artifact-issue",
      pullRequest: "artifact-pr",
      repositoryMetadata: "artifact-repo",
    },
    enqueuedAt: "2026-05-01T00:00:00.000Z",
  };
}

function createCaseVersion(data: CaseBuilderPrepareJobData): CaseVersionRow {
  return {
    id: data.caseVersionId,
    caseId: data.caseId,
    version: 1,
    status: "candidate",
    githubIssueId: data.githubIssueId,
    githubPullRequestId: data.githubPullRequestId,
    issueArtifactId: data.artifactIds.issue,
    pullRequestArtifactId: data.artifactIds.pullRequest,
    repositoryMetadataArtifactId: data.artifactIds.repositoryMetadata,
    goldPatchArtifactId: null,
    testPatchArtifactId: null,
    validationLogArtifactId: null,
    repoOwner: "owner",
    repoName: "repo",
    baseCommitSha: "base",
    goldCommitSha: null,
    environmentRecipe: {},
    setupCommands: [],
    testCommands: [],
    promptVersions: {},
    testBuilderModelId: null,
    validationRunnerVersion: null,
    metadata: {},
    createdAt: new Date("2026-05-01T00:00:00.000Z"),
    frozenAt: null,
  };
}

function createArtifact(id: string): ArtifactRow {
  return {
    id,
    kind: "raw_json",
    storageProvider: "s3",
    bucket: "bucket",
    objectKey: id,
    sha256: "sha",
    byteSize: 1,
    contentType: "application/json",
    metadata: {},
    createdAt: new Date("2026-05-01T00:00:00.000Z"),
  };
}

function createStore(input: {
  caseVersion?: CaseVersionRow;
  artifacts?: ArtifactRow[];
  githubIssueExists?: boolean;
  githubPullRequestExists?: boolean;
}): CaseBuilderPreflightStore {
  return {
    async findCaseVersionById() {
      return input.caseVersion;
    },
    async githubIssueExists() {
      return input.githubIssueExists ?? true;
    },
    async githubPullRequestExists() {
      return input.githubPullRequestExists ?? true;
    },
    async findArtifactsByIds(ids) {
      const artifactIds = new Set(ids);
      return (input.artifacts ?? []).filter((artifact) =>
        artifactIds.has(artifact.id),
      );
    },
  };
}

function createJob(
  data: CaseBuilderPrepareJobData,
  progressStages: string[],
): CaseBuilderPrepareJobLike {
  return {
    data,
    async updateProgress(progress) {
      progressStages.push(progress.stage);
    },
  };
}
