import { test } from "node:test";
import assert from "node:assert/strict";

// We don't exercise the live E2B path here; we just lock in the module's
// exported constants/typing so workers can rely on the contract.
import {
  GRADER_OUTPUT_FILENAME,
  GRADER_SANDBOX_ROOT,
  type GraderContextFile,
  type RunPiJsonGraderInput,
} from "./index.js";

test("module exports the sandbox conventions the worker depends on", () => {
  assert.equal(GRADER_OUTPUT_FILENAME, "grader-output.json");
  assert.equal(GRADER_SANDBOX_ROOT.startsWith("/home/user/"), true);
});

test("RunPiJsonGraderInput shape carries everything the helper needs", () => {
  // This test is intentionally just a compile-time + structural check.
  const sample: RunPiJsonGraderInput = {
    jobTag: "plan",
    apiKey: "key",
    modelId: "model",
    systemPrompt: "system",
    userPrompt: "user",
    contextFiles: [{ name: "ISSUE.md", content: "..." } satisfies GraderContextFile],
  };
  assert.equal(sample.jobTag, "plan");
  assert.equal(sample.contextFiles.length, 1);
});
