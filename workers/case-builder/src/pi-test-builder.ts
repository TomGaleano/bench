import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { JsonValue } from "@pilab/object-store";
import type {
  ProposedTestBuilderCandidate,
  TestBuilderInput,
  TestBuilderRun,
} from "./openrouter-test-builder.js";
import { parseProposedTestBuilderCandidate } from "./openrouter-test-builder.js";

const execFileAsync = promisify(execFile);

export type PiTestBuilderConfig = {
  apiKey: string;
  modelId: string;
  provider?: string;
  maxWallClockSeconds?: number;
  maxAttempts?: number;
};

function logError(context: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  console.error(`[pi-agent] ERROR in ${context}: ${message}`);
  if (stack) {
    console.error(`[pi-agent] Stack: ${stack}`);
  }
}

export function createPiTestBuilder(config: PiTestBuilderConfig) {
  const provider = config.provider ?? "openrouter";
  const maxWallClockSeconds = config.maxWallClockSeconds ?? 300;
  const maxAttempts = config.maxAttempts ?? 2;

  return {
    async build(input: TestBuilderInput): Promise<TestBuilderRun> {
      const requestedAt = new Date().toISOString();
      const compactInput = createCompactTestBuilderInput(input);
      const repoUrl = `https://github.com/${compactInput.repository.owner}/${compactInput.repository.name}.git`;
      const goldCommitSha =
        compactInput.repository.mergeSha ??
        readOptionalString(compactInput.repository.head, "sha");

      if (!goldCommitSha) {
        throw new Error("Cannot run Pi test builder without a gold commit SHA");
      }

      const tempRoot = await mkdtemp(
        path.join(tmpdir(), "pilab-pi-test-builder-"),
      );
      const workspacePath = path.join(tempRoot, "repo");

      try {
        await cloneCommit(repoUrl, goldCommitSha, workspacePath, 120_000);

        const detectedTestRunner = await detectTestRunner(workspacePath);
        if (detectedTestRunner) {
          console.log(`[pi-agent] Detected test runner: ${detectedTestRunner.name}`);
        }

        const contextPath = path.join(tempRoot, "context.json");
        const contextPayload: Record<string, unknown> = { ...compactInput };
        
        if (input.testPatchArtifact) {
          const testPatchStr = readOptionalString(input.testPatchArtifact, "testPatch");
          if (testPatchStr) {
            contextPayload.prIncludesTests = true;
            contextPayload.testPatchInfo = {
              testFiles: readArray(input.testPatchArtifact, "testFiles"),
              patchPreview: testPatchStr.slice(0, 2000),
            };
            console.log("[pi-agent] PR includes test patch - informing agent to search for existing tests");
          }
        }

        if (detectedTestRunner) {
          contextPayload.detectedTestRunner = detectedTestRunner;
        }
        
        await writeFile(
          contextPath,
          JSON.stringify(contextPayload, null, 2),
          "utf8",
        );

        let lastError: Error | undefined;
        let lastRawResponse: JsonValue | undefined;

        // Seed the retry loop with validation runner feedback (if available) so the agent
        // sees it as `previousError` on attempt 1 — no need to read the context file.
        if (input.previousAttemptLogs) {
          const formatted = formatPreviousErrorForAgent(input.previousAttemptLogs);
          if (formatted) {
            lastError = new Error(formatted);
          }
        }

        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
          try {
            const result = await runPiAgent({
              workspacePath,
              contextPath,
              apiKey: config.apiKey,
              modelId: config.modelId,
              provider,
              maxWallClockSeconds,
              attempt,
              ...(detectedTestRunner && { detectedTestRunner }),
              previousError: lastError?.message,
            });

            lastRawResponse = result.rawResponse;

            console.log(`[pi-agent] Raw response preview: ${result.proposalText.slice(0, 500)}`);
            console.log(`[pi-agent] Full response length: ${result.proposalText.length}`);

            const parsed = parseJsonObject(result.proposalText);
            console.log(`[pi-agent] JSON parsed, type: ${typeof parsed}`);
            
            const candidate = parseProposedTestBuilderCandidate(parsed);
            console.log(`[pi-agent] Candidate parsed: ${candidate.proposedTests.length} tests`);

            return {
              modelId: config.modelId,
              requestedAt,
              completedAt: new Date().toISOString(),
              candidate,
              rawResponse: lastRawResponse,
              attempts: attempt,
            };
          } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));
            logError(`attempt ${attempt}`, lastError);
            if (attempt === maxAttempts) {
              throw lastError;
            }
          }
        }

        throw lastError ?? new Error("Pi test builder failed");
      } finally {
        await rm(tempRoot, { recursive: true, force: true });
      }
    },
  };
}

async function runPiAgent(input: {
  workspacePath: string;
  contextPath: string;
  apiKey: string;
  modelId: string;
  provider: string;
  maxWallClockSeconds: number;
  attempt: number;
  detectedTestRunner?: { name: string; command: string };
  previousError?: string | undefined;
}): Promise<{ proposalText: string; rawResponse: JsonValue }> {
  console.log(`[pi-agent] Starting attempt ${input.attempt} with model ${input.modelId}`);
  const pi = await import("@mariozechner/pi-coding-agent");
  console.log("[pi-agent] Pi SDK imported");

  const authStorage = pi.AuthStorage.create(
    path.join(input.workspacePath, ".pi-auth.json"),
  );
  authStorage.setRuntimeApiKey(input.provider, input.apiKey);

  const modelRegistry = pi.ModelRegistry.create(authStorage);
  const model = modelRegistry.find(input.provider, input.modelId);

  if (!model) {
    throw new Error(
      `Pi model not found for provider ${input.provider}: ${input.modelId}`,
    );
  }
  console.log(`[pi-agent] Model resolved: ${model.id}`);

  const settingsManager = pi.SettingsManager.inMemory({
    compaction: { enabled: false },
    retry: { enabled: true, maxRetries: 1 },
  });

  const resourceLoader = new pi.DefaultResourceLoader({
    cwd: input.workspacePath,
    agentDir: path.join(input.workspacePath, ".pi-agent"),
    settingsManager,
    systemPromptOverride: () =>
      buildSystemPrompt(input.attempt, input.detectedTestRunner, input.previousError),
  });
  await resourceLoader.reload();
  console.log("[pi-agent] Resource loader ready");

  const { session } = await pi.createAgentSession({
    cwd: input.workspacePath,
    agentDir: path.join(input.workspacePath, ".pi-agent"),
    model,
    thinkingLevel: "off",
    authStorage,
    modelRegistry,
    tools: ["read", "grep", "find", "ls"],
    resourceLoader,
    sessionManager: pi.SessionManager.inMemory(input.workspacePath),
    settingsManager,
  });
  console.log("[pi-agent] Session created");

  const rawEvents: Array<Record<string, unknown>> = [];
  let finalAssistantText = "";

  session.subscribe((event: Record<string, unknown>) => {
    rawEvents.push(event);

    if (event.type === "agent_end" && Array.isArray(event.messages)) {
      const messages = event.messages as Array<{
        role: string;
        content: Array<{ type: string; text?: string }>;
      }>;
      const assistantMessages = messages.filter(
        (msg) => msg.role === "assistant",
      );
      const lastAssistant = assistantMessages[assistantMessages.length - 1];
      if (lastAssistant) {
        finalAssistantText = lastAssistant.content
          .filter(
            (
              block,
            ): block is { type: "text"; text: string } =>
              block.type === "text" && typeof block.text === "string",
          )
          .map((block) => block.text)
          .join("\n");
      }
    }
  });

  const prompt = buildUserPrompt(input.contextPath, input.attempt);
  console.log(`[pi-agent] Sending prompt (${prompt.length} chars)`);

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error(`Pi agent timed out after ${input.maxWallClockSeconds}s`));
    }, input.maxWallClockSeconds * 1000);
  });

  await Promise.race([
    (async () => {
      await session.prompt(prompt);
      console.log("[pi-agent] Prompt complete, waiting for idle");
      await session.agent.waitForIdle();
      console.log("[pi-agent] Agent idle");
    })(),
    timeoutPromise,
  ]);

  if (!finalAssistantText.trim()) {
    throw new Error("Pi agent did not produce any text response");
  }

  console.log(`[pi-agent] Got response (${finalAssistantText.length} chars)`);
  return {
    proposalText: finalAssistantText,
    rawResponse: rawEvents as unknown as JsonValue,
  };
}

function buildSystemPrompt(
  attempt: number,
  detectedTestRunner?: { name: string; command: string },
  previousError?: string,
): string {
  const parts = [
    "You are an expert software engineer specializing in regression tests.",
    "Your task is to validate a bug fix by finding or creating executable tests.",
    "You have read-only access to the codebase via read, grep, find, and ls tools.",
    "",
    "IMPORTANT - Search for existing tests FIRST:",
    "1. Look for test files that were modified in the PR (check the changed files list)",
    "2. Search for tests related to the bug (grep for test functions, assertions, or test files near the changed code)",
    "3. If the PR already includes test changes, analyze what they test and how",
    "4. If suitable existing tests are found, you can reference them instead of creating new ones",
    "",
    "CRITICAL - Your test must actually catch the bug:",
    "- You are currently looking at the FIXED code (gold commit).",
    "- READ the code patches in the context file to understand exactly what changed.",
    "- Imagine the code BEFORE the fix (base commit). What would have failed?",
    "- Your test must verify the NEW behavior added by the fix.",
    "- If the fix added error handling, your test must trigger the error condition.",
    "- If the fix changed output format, your test must assert the correct output.",
    "- In the rationale, explicitly explain WHY this test would have failed on base.",
    "",
    "If no suitable existing tests exist, create exactly ONE new fail_to_pass test that:",
    "- Would FAIL on the buggy code (before the fix)",
    "- Would PASS on the fixed code (after the fix)",
    "- Is self-contained and executable with a standard test command",
    "- Prefer adding to an existing test file near the changed code",
    "- Keep the test under 120 lines",
    "",
    "If the issue cannot be tested with unit tests (e.g., UI bug, CLI behavior, performance issue),",
    "propose a behavioral reproduction script instead - a script that demonstrates the bug.",
    "",
    "Return ONLY a JSON object with this structure:",
    '{',
    '  "proposedTests": [{',
    '    "name": "descriptive test name",',
    '    "kind": "fail_to_pass",',
    '    "filePath": "path/to/test.file",',
    '    "testCommand": "npm test path/to/test.file",',
    '    "content": "full test code here (include ALL necessary imports at the top)",',
    '    "rationale": "why this test validates the fix AND why it would fail on base"',
    '  }],',
    '  "notes": ["any observations about existing tests or test coverage"],',
    '  "existingTestsFound": true or false,',
    '  "behavioralReproduction": false or { "script": "repro script", "rationale": "why unit tests will not work" }',
    '}',
    "",
    "Rules:",
    "- Do NOT wrap the JSON in markdown code blocks",
    "- testCommand must start with: pnpm, npm, yarn, npx, node, bun, pytest, python, go test, cargo test, mvn, gradle, or ./gradlew",
    "- If existing tests were found, set existingTestsFound: true and explain in notes",
    "- Read the patch for each changed file before creating the test",
    "- INCLUDE ALL REQUIRED IMPORTS in the test content. If you use pytest, numpy, etc. in the test code, add the import at the top.",
    "- Make sure the test command actually matches the test file path and test function name.",
    ...(detectedTestRunner
      ? [
          "",
          `This repository uses ${detectedTestRunner.name} for testing. Preferred test command prefix: ${detectedTestRunner.command}.`,
        ]
      : []),
  ];

  if (attempt > 1 && previousError) {
    const details = parsePreviousError(previousError);
    parts.push(
      "",
      "=== FEEDBACK FROM PREVIOUS ATTEMPT ===",
      `This is retry attempt #${attempt}. The previous test was rejected.`,
      "",
      ...(details.testName ? [`Test name: ${details.testName}`] : []),
      ...(details.testKind ? [`Test kind: ${details.testKind}`] : []),
      ...(details.command ? [`Command: ${details.command}`] : []),
      ...(details.baseExit !== undefined ? [`Base exit code: ${details.baseExit} (expected non-zero for fail_to_pass)`] : []),
      ...(details.goldExit !== undefined ? [`Gold exit code: ${details.goldExit} (expected zero for fail_to_pass)`] : []),
      "",
      `Issue: ${details.issueCode ?? "unknown"}`,
      `${details.issueMessage ?? previousError}`,
      "",
      ...(details.baseOutput ? [`Base output:\n${details.baseOutput}`] : []),
      ...(details.goldOutput ? [`Gold output:\n${details.goldOutput}`] : []),
      "",
      "=== HOW TO FIX ===",
      ...getFixSuggestions(details),
      "",
      "Please produce a corrected test that addresses ALL of the above issues.",
    );
  }

  return parts.join("\n");
}

/** Parse structured previousError string into fields. Format: "PILAB_FEEDBACK|issueCode|msg|baseExit|goldExit|baseOut|goldOut|testName|testKind|command" */
function parsePreviousError(raw: string): {
  issueCode: string;
  issueMessage: string;
  baseExit: number | undefined;
  goldExit: number | undefined;
  baseOutput: string | undefined;
  goldOutput: string | undefined;
  testName: string | undefined;
  testKind: string | undefined;
  command: string | undefined;
} {
  if (raw.startsWith("PILAB_FEEDBACK|")) {
    const parts = raw.split("|");
    return {
      issueCode: parts[1] ?? "unknown",
      issueMessage: parts[2] ?? raw,
      baseExit: parts[3] ? Number(parts[3]) : undefined,
      goldExit: parts[4] ? Number(parts[4]) : undefined,
      baseOutput: parts[5] || undefined,
      goldOutput: parts[6] || undefined,
      testName: parts[7] || undefined,
      testKind: parts[8] || undefined,
      command: parts[9] || undefined,
    };
  }
  // Fallback: unstructured text
  return { issueCode: "unknown", issueMessage: raw, baseExit: undefined, goldExit: undefined, baseOutput: undefined, goldOutput: undefined, testName: undefined, testKind: undefined, command: undefined };
}

function getFixSuggestions(details: ReturnType<typeof parsePreviousError>): string[] {
  const suggestions: string[] = [];
  const code = details.issueCode || "";

  if (code === "pass_fail_contract_not_met") {
    if (details.baseExit === 0 && details.goldExit === 0) {
      suggestions.push("- Both base AND gold passed. Your test doesn't catch the bug — it passes on the unfixed code too.");
      suggestions.push("- Rethink: what exact behavior did the PR change? The test should FAIL on the OLD code.");
      suggestions.push("- Check the PR diff to find a code path that was modified. Your test must trigger that path.");
      suggestions.push("- Verify the test command matches the test file path and function name exactly.");
    } else if (details.baseExit !== 0 && details.goldExit !== 0) {
      suggestions.push("- Both base AND gold failed. The test itself has a bug (import error, syntax error, etc.).");
      suggestions.push("- Check for missing imports. If you use pytest decorators, add 'import pytest' at the top.");
      suggestions.push("- Make sure the test file path and function name match what the test command expects.");
    }
  }

  if (code === "test_setup_failed") {
    suggestions.push("- The test couldn't even run — there's a setup/import problem.");
    suggestions.push("- Check ALL imports in the test code. Common issues:");
    suggestions.push("  • 'import pytest' missing when using @pytest.mark.parametrize");
    suggestions.push("  • 'import numpy as np' missing when using np.array()");
    suggestions.push("  • 'from <package> import <module>' with wrong module path");
  }

  if (details.baseOutput?.includes("NameError") || details.goldOutput?.includes("NameError")) {
    suggestions.push("- CRITICAL: The test file has a NameError — a name is used without being imported.");
    suggestions.push("- Fix: add the missing import at the top of the test content field.");
    suggestions.push("- Common: 'import pytest', 'import numpy as np', 'import pandas as pd'.");
  }

  if (suggestions.length === 0) {
    suggestions.push("- Review the error output carefully and fix the root cause.");
    suggestions.push("- Ensure all imports are present and the test file path is correct.");
  }

  suggestions.push("- Keep the test focused — test ONE specific behavior change from the PR.");
  return suggestions;
}

function buildUserPrompt(contextPath: string, attempt: number): string {
  const parts = [
    `I have written the issue, pull request, and repository metadata to ${contextPath}.`,
    "",
    "Your mission:",
    "1. READ the context file to understand the bug, fix, and changed files",
    ...(attempt > 1 ? [
      "2. LOOK for the 'previousAttemptFeedback' field in the context file — it contains detailed feedback",
      "   on why the previous test was rejected. Fix ALL issues mentioned there.",
      "3. Then create the proposed tests as instructed above.",
    ] : [
      "2. Then create the proposed tests or behavioral reproduction as instructed above.",
    ]),
  ].join("\n");
  return parts;
}

async function cloneCommit(
  repoUrl: string,
  commitSha: string,
  destinationPath: string,
  timeoutMs: number,
): Promise<void> {
  await execFileAsync("git", ["init", destinationPath], {
    timeout: timeoutMs,
  });

  await execFileAsync(
    "git",
    ["-C", destinationPath, "remote", "add", "origin", repoUrl],
    { timeout: timeoutMs },
  );

  const fetch = await execFileAsync(
    "git",
    ["-C", destinationPath, "fetch", "--depth", "1", "origin", commitSha],
    { timeout: timeoutMs },
  );
  if (fetch.stdout.includes("fatal") || fetch.stderr?.includes("fatal")) {
    throw new Error(`git fetch failed: ${fetch.stderr || fetch.stdout}`);
  }

  await execFileAsync(
    "git",
    ["-C", destinationPath, "checkout", "--detach", "FETCH_HEAD"],
    { timeout: timeoutMs },
  );
}

function createCompactTestBuilderInput(input: TestBuilderInput) {
  const issue = readRecord(input.issueArtifact, "issue");
  const pullRequest = readRecord(input.pullRequestArtifact, "pullRequest");
  const repository = readRecord(input.repositoryMetadataArtifact, "repository");
  const base = readRecord(input.repositoryMetadataArtifact, "base");
  const head = readRecord(input.repositoryMetadataArtifact, "head");
  const changedFiles = readArray(input.repositoryMetadataArtifact, "changedFiles")
    .filter(isRecord)
    .slice(0, 30);

  return {
    issue: {
      title: readOptionalString(issue, "title"),
      body: truncate(readOptionalString(issue, "body"), 4_000),
      state: readOptionalString(issue, "state"),
      url: readOptionalString(issue, "url"),
    },
    pullRequest: {
      title: readOptionalString(pullRequest, "title"),
      body: truncate(readOptionalString(pullRequest, "body"), 3_000),
      url:
        readOptionalString(pullRequest, "html_url") ??
        readOptionalString(pullRequest, "url"),
      baseRef: readOptionalString(readRecord(pullRequest, "base"), "ref"),
      headRef: readOptionalString(readRecord(pullRequest, "head"), "ref"),
    },
    repository: {
      owner: readOptionalString(repository, "owner"),
      name: readOptionalString(repository, "name"),
      base,
      head,
      mergeSha: readOptionalString(input.repositoryMetadataArtifact, "mergeSha"),
      changedFiles: changedFiles.map(summarizeChangedFile),
    },
    previousAttemptLogs: input.previousAttemptLogs
      ? JSON.stringify(input.previousAttemptLogs).slice(0, 3_000)
      : null,
    previousAttemptFeedback: input.previousAttemptLogs
      ? formatPreviousAttemptFeedback(input.previousAttemptLogs)
      : null,
  };
}

function formatPreviousAttemptFeedback(logs: unknown): string {
  try {
    const data = isRecord(logs) ? logs : {};
    const tests = readArray(data, "tests");
    if (tests.length === 0) return "No test results from previous attempt.";

    const lines: string[] = ["=== PREVIOUS ATTEMPT FEEDBACK ==="];

    for (const test of tests) {
      if (!isRecord(test)) continue;
      const name = test.name ?? "unknown";
      const kind = test.kind ?? "unknown";
      const status = test.status ?? "unknown";
      const issues = readArray(test, "issues");

      lines.push(`Test: ${name}`);
      lines.push(`  Kind: ${kind} | Status: ${status}`);

      const base = isRecord(test.base) ? test.base : null;
      const gold = isRecord(test.gold) ? test.gold : null;

      if (base) {
        lines.push(`  Base exit code: ${base.exitCode ?? "N/A"}`);
        const baseStderr = String(base.stderr ?? "").slice(0, 300);
        if (baseStderr) lines.push(`  Base stderr: ${baseStderr}`);
      }
      if (gold) {
        lines.push(`  Gold exit code: ${gold.exitCode ?? "N/A"}`);
        const goldStderr = String(gold.stderr ?? "").slice(0, 300);
        if (goldStderr) lines.push(`  Gold stderr: ${goldStderr}`);
      }

      for (const issue of issues) {
        if (!isRecord(issue)) continue;
        lines.push(`  Issue: [${issue.code}] ${String(issue.message ?? "").slice(0, 400)}`);
      }
      lines.push("");
    }

    return lines.join("\n");
  } catch {
    return "Could not parse previous attempt feedback.";
  }
}

/** Format previous validation logs into a PILAB_FEEDBACK structured string for the agent */
function formatPreviousErrorForAgent(logs: unknown): string | null {
  try {
    const data = isRecord(logs) ? logs : {};
    const tests = readArray(data, "tests");
    if (tests.length === 0) return null;

    const test = isRecord(tests[0]) ? tests[0] : null;
    if (!test) return null;

    const issues = readArray(test, "issues");
    const issue = isRecord(issues[0]) ? issues[0] : null;
    const issueCode = String(issue?.code ?? "unknown");
    const issueMsg = String(issue?.message ?? "No details").slice(0, 500);

    const base = isRecord(test.base) ? test.base : null;
    const gold = isRecord(test.gold) ? test.gold : null;
    const baseExit = base?.exitCode ?? "";
    const goldExit = gold?.exitCode ?? "";
    const baseOut = String(base?.stderr ?? base?.stdout ?? "").slice(0, 300);
    const goldOut = String(gold?.stderr ?? gold?.stdout ?? "").slice(0, 300);
    const testName = String(test.name ?? "");
    const testKind = String(test.kind ?? "");
    const command = String(test.testCommand ?? "").slice(0, 200);

    // PILAB_FEEDBACK|code|message|baseExit|goldExit|baseOut|goldOut|testName|kind|command
    return [
      "PILAB_FEEDBACK",
      issueCode,
      issueMsg.replace(/\n/g, " | "),
      baseExit,
      goldExit,
      baseOut.replace(/\n/g, " "),
      goldOut.replace(/\n/g, " "),
      testName,
      testKind,
      command,
    ].join("|");
  } catch {
    return null;
  }
}

function summarizeChangedFile(file: Record<string, unknown>) {
  return {
    filename: readOptionalString(file, "filename"),
    status: readOptionalString(file, "status"),
    additions: readOptionalNumber(file, "additions"),
    deletions: readOptionalNumber(file, "deletions"),
    changes: readOptionalNumber(file, "changes"),
    patch: truncate(readOptionalString(file, "patch"), 6_000),
  };
}

function readRecord(value: unknown, key: string): Record<string, unknown> {
  if (!isRecord(value)) return {};
  const item = value[key];
  return isRecord(item) ? item : {};
}

function readArray(value: unknown, key: string): unknown[] {
  if (!isRecord(value)) return [];
  const item = value[key];
  return Array.isArray(item) ? item : [];
}

function readOptionalString(value: unknown, key: string): string | null {
  if (!isRecord(value)) return null;
  const item = value[key];
  return typeof item === "string" && item.length > 0 ? item : null;
}

function readOptionalNumber(value: unknown, key: string): number | null {
  if (!isRecord(value)) return null;
  const item = value[key];
  return typeof item === "number" && Number.isFinite(item) ? item : null;
}

function truncate(value: string | null, maxLength: number): string | null {
  if (!value || value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}...`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonObject(content: string): unknown {
  const trimmed = content.trim();

  try {
    return JSON.parse(trimmed);
  } catch {
    // ignore
  }

  const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch?.[1]) {
    try {
      return JSON.parse(codeBlockMatch[1].trim());
    } catch {
      // ignore
    }
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    try {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
    } catch {
      // ignore
    }
  }

  throw new Error(
    `Pi agent returned invalid JSON: ${trimmed.slice(0, 200)}`,
  );
}

async function detectTestRunner(
  repoPath: string,
): Promise<{ name: string; command: string } | null> {
  const { readFile, stat } = await import("node:fs/promises");

  try {
    const pkgJsonPath = path.join(repoPath, "package.json");
    await stat(pkgJsonPath);
    const content = await readFile(pkgJsonPath, "utf8");
    const pkg = JSON.parse(content) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      scripts?: Record<string, string>;
    };
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };

    if (deps?.vitest) return { name: "vitest", command: "npx vitest run" };
    if (deps?.jest) return { name: "jest", command: "npx jest" };
    if (deps?.mocha) return { name: "mocha", command: "npx mocha" };
    if (deps?.ava) return { name: "ava", command: "npx ava" };
    if (deps?.jasmine) return { name: "jasmine", command: "npx jasmine" };
    if (deps?.tap) return { name: "tap", command: "npx tap" };

    if (pkg.scripts?.test) {
      const script = pkg.scripts.test;
      if (script.includes("vitest")) return { name: "vitest", command: "npx vitest run" };
      if (script.includes("jest")) return { name: "jest", command: "npx jest" };
      if (script.includes("mocha")) return { name: "mocha", command: "npx mocha" };
    }
  } catch {
    // ignore
  }

  return null;
}
