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

  const prompt = buildUserPrompt(input.contextPath);
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
    '    "content": "full test code here",',
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
    ...(detectedTestRunner
      ? [
          "",
          `This repository uses ${detectedTestRunner.name} for testing. Preferred test command prefix: ${detectedTestRunner.command}.`,
        ]
      : []),
  ];

  if (attempt > 1 && previousError) {
    parts.push(
      "",
      `Previous attempt failed with: ${previousError}`,
      "Please produce a simpler, more conservative test that is more likely to be correct.",
    );
  }

  return parts.join("\n");
}

function buildUserPrompt(contextPath: string): string {
  return [
    `I have written the issue, pull request, and repository metadata to ${contextPath}.`,
    "",
    "Your mission:",
    "1. READ the context file to understand the bug, fix, and changed files",
    "2. SEARCH for existing tests in the changed files (especially any test files in the PR)",
    "3. If test files were modified, READ them to understand the test strategy",
    "4. SEARCH the codebase for related test files near the changed code",
    "5. If suitable tests exist, analyze them. If not, create one.",
    "6. Consider if this is a behavioral issue (UI, CLI, etc.) that needs a reproduction script",
    "",
    "Return ONLY the JSON object. No markdown. No explanations outside the JSON.",
  ].join("\n");
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
  };
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
