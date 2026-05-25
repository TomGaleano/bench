import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createCaseBuilderPrepareJobId,
  createCaseBuilderProgress,
  createValidationRunnerJobId,
  createValidationRunnerProgress,
} from "./index.js";

describe("case-builder job helpers", () => {
  it("creates stable prepare job ids", () => {
    assert.equal(
      createCaseBuilderPrepareJobId("9f5a83d7-7e27-4d9d-819b-2f5f5582aab6"),
      "case-builder-prepare-9f5a83d7-7e27-4d9d-819b-2f5f5582aab6",
    );
  });

  it("creates timestamped progress payloads", () => {
    const progress = createCaseBuilderProgress(
      "validating-artifacts",
      "Checking artifacts",
    );

    assert.equal(progress.stage, "validating-artifacts");
    assert.equal(progress.message, "Checking artifacts");
    assert.ok(Date.parse(progress.at));
  });
});

describe("validation-runner job helpers", () => {
  it("creates stable validation job ids", () => {
    assert.equal(
      createValidationRunnerJobId("93e01ab0-f6b2-410e-b435-c2d5a8989b59"),
      "validation-runner-validate-93e01ab0-f6b2-410e-b435-c2d5a8989b59",
    );
  });

  it("creates timestamped validation progress payloads", () => {
    const progress = createValidationRunnerProgress(
      "checking-repository-refs",
      "Checking base and gold refs",
    );

    assert.equal(progress.stage, "checking-repository-refs");
    assert.equal(progress.message, "Checking base and gold refs");
    assert.match(progress.at, /^\d{4}-\d{2}-\d{2}T/);
  });
});
