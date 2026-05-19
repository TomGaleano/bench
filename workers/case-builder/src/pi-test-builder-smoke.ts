/**
 * Smoke test for Pi test builder.
 *
 * Run with:
 *   OPENROUTER_API_KEY=... TEST_BUILDER_MODEL_ID=kimi/kimi-k2-6 tsx src/pi-test-builder-smoke.ts
 *
 * This verifies:
 * - Pi SDK imports correctly
 * - Model resolution works for the configured provider/model
 * - A minimal prompt produces a response
 */

import { createPiTestBuilder } from "./pi-test-builder.js";

const apiKey = process.env.OPENROUTER_API_KEY;
const modelId = process.env.TEST_BUILDER_MODEL_ID ?? "kimi/kimi-k2-6";

if (!apiKey) {
  console.error("OPENROUTER_API_KEY is required");
  process.exit(1);
}

async function main() {
  console.log(`Testing Pi test builder with model: ${modelId}`);

  const builder = createPiTestBuilder({
    apiKey: apiKey!,
    modelId,
    maxWallClockSeconds: 60,
    maxAttempts: 1,
  });

  const result = await builder.build({
    issueArtifact: {
      title: "Fix null pointer in user authentication",
      body: "When logging in with a deleted user account, the server throws a null pointer exception instead of returning a 401.",
      state: "closed",
      url: "https://github.com/example/repo/issues/123",
    },
    pullRequestArtifact: {
      title: "fix(auth): handle deleted users gracefully",
      body: "Added a null check before accessing user properties.",
      html_url: "https://github.com/example/repo/pull/456",
      base: { ref: "main" },
      head: { ref: "fix-deleted-user" },
    },
    repositoryMetadataArtifact: {
      owner: "example",
      name: "repo",
      base: { sha: "abc123" },
      head: { sha: "def456" },
      mergeSha: "def456",
      changedFiles: [
        {
          filename: "src/auth/login.ts",
          status: "modified",
          additions: 5,
          deletions: 1,
          changes: 6,
          patch: "@@ -10,5 +10,9 @@ function login(user) {\n+  if (!user) {\n+    return 401;\n+  }",
        },
      ],
    },
  });

  console.log("\n=== Result ===");
  console.log(`Model: ${result.modelId}`);
  console.log(`Attempts: ${result.attempts}`);
  console.log(`Proposed tests: ${result.candidate.proposedTests.length}`);
  for (const test of result.candidate.proposedTests) {
    console.log(`\n--- Test: ${test.name} ---`);
    console.log(`Kind: ${test.kind}`);
    console.log(`File: ${test.filePath}`);
    console.log(`Command: ${test.testCommand}`);
    console.log(`Rationale: ${test.rationale}`);
    console.log(`Content:\n${test.content}`);
  }
  console.log(`\nNotes: ${result.candidate.notes.join("; ")}`);
}

main().catch((error) => {
  console.error("Smoke test failed:", error);
  process.exit(1);
});
