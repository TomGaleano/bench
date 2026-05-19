import type { JsonValue } from "@pilab/object-store";

export type ProposedTestKind = "fail_to_pass" | "pass_to_pass";

export type ProposedTestSpec = {
  name: string;
  kind: ProposedTestKind;
  filePath: string;
  testCommand: string;
  expectedFailureMode?: string;
  expectedPassMode?: string;
  content: string;
  rationale: string;
};

export type BehavioralReproduction = {
  script: string;
  rationale: string;
};

export type ProposedTestBuilderCandidate = {
  schemaVersion: "pilab.test-builder.proposal.v1";
  proposedTests: ProposedTestSpec[];
  notes: string[];
  existingTestsFound?: boolean;
  behavioralReproduction?: BehavioralReproduction;
};

export type TestBuilderInput = {
  issueArtifact: JsonValue;
  pullRequestArtifact: JsonValue;
  repositoryMetadataArtifact: JsonValue;
  testPatchArtifact?: JsonValue;
  previousAttemptLogs?: JsonValue;
};

export type TestBuilderRun = {
  modelId: string;
  requestedAt: string;
  completedAt: string;
  candidate: ProposedTestBuilderCandidate;
  rawResponse: JsonValue;
  attempts: number;
};

export type OpenRouterTestBuilderConfig = {
  apiKey: string;
  modelId: string;
  fetchImpl?: typeof fetch;
  maxAttempts?: number;
};

type OpenRouterChatResponse = {
  id?: string;
  model?: string;
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
  usage?: JsonValue;
  error?: {
    message?: string;
  };
};

type RetryContext = {
  attempt: number;
  maxAttempts: number;
  lastError: Error;
  lastContent: string | null;
};

const testProposalSchema = {
  type: "object",
  properties: {
    proposedTests: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          kind: { type: "string", enum: ["fail_to_pass", "pass_to_pass"] },
          filePath: { type: "string" },
          testCommand: { type: "string" },
          expectedFailureMode: { type: "string" },
          expectedPassMode: { type: "string" },
          content: { type: "string" },
          rationale: { type: "string" },
        },
        required: ["name", "kind", "filePath", "testCommand", "content", "rationale"],
        additionalProperties: false,
      },
    },
    notes: {
      type: "array",
      items: { type: "string" },
    },
  },
  required: ["proposedTests", "notes"],
  additionalProperties: false,
} as const;

export function createOpenRouterTestBuilder(config: OpenRouterTestBuilderConfig) {
  const fetchImpl = config.fetchImpl ?? fetch;
  const maxAttempts = config.maxAttempts ?? 3;

  return {
    async build(input: TestBuilderInput): Promise<TestBuilderRun> {
      const requestedAt = new Date().toISOString();
      const messages = createTestBuilderMessages(input);
      let lastError: Error | undefined;
      let lastRawResponse: JsonValue | undefined;
      let lastContent: string | null = null;

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const response = await fetchImpl("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
            "X-OpenRouter-Title": "Pi Lab Case Builder",
          },
          body: JSON.stringify({
            model: config.modelId,
            messages:
              attempt === 1
                ? messages
                : [
                    ...messages,
                    {
                      role: "user",
                      content: buildRetryPrompt({
                        attempt,
                        maxAttempts,
                        lastError: lastError!,
                        lastContent,
                      }),
                    },
                  ],
            response_format: {
              type: "json_schema",
              json_schema: {
                name: "pilab_test_builder_proposal",
                strict: true,
                schema: testProposalSchema,
              },
            },
            temperature: 0,
            max_tokens: attempt === 1 ? 3200 : attempt === 2 ? 2400 : 1800,
            provider: {
              allow_fallbacks: false,
            },
          }),
        });

        const rawResponse = (await response.json()) as OpenRouterChatResponse;
        lastRawResponse = toJsonValue(rawResponse);

        if (!response.ok) {
          const isRetryable = [429, 502, 503, 504].includes(response.status);
          const errorMessage =
            rawResponse.error?.message ?? `HTTP ${response.status}`;

          if (isRetryable && attempt < maxAttempts) {
            lastError = new Error(
              `OpenRouter transient error (${response.status}): ${errorMessage}`
            );
            await delay(1_000 * attempt);
            continue;
          }

          throw new Error(
            `OpenRouter test builder failed with HTTP ${response.status}: ${errorMessage}`
          );
        }

        const content = rawResponse.choices?.[0]?.message?.content;

        if (!content) {
          if (attempt < maxAttempts) {
            lastError = new Error("OpenRouter test builder returned empty content");
            await delay(500);
            continue;
          }
          throw new Error("OpenRouter test builder returned no message content");
        }

        lastContent = content;

        try {
          const parsed = parseJsonObject(content);
          const candidate = parseProposedTestBuilderCandidate(parsed);

          return {
            modelId: rawResponse.model ?? config.modelId,
            requestedAt,
            completedAt: new Date().toISOString(),
            candidate,
            rawResponse: lastRawResponse,
            attempts: attempt,
          };
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));

          if (attempt === maxAttempts) {
            throw lastError;
          }
        }
      }

      throw lastError ?? new Error("OpenRouter test builder failed after all retries");
    },
  };
}

function buildRetryPrompt(ctx: RetryContext): string {
  const { attempt, maxAttempts, lastError, lastContent } = ctx;
  const lines: string[] = [
    `ATTEMPT ${attempt - 1} of ${maxAttempts} failed.`,
    "",
    `Error: ${lastError.message}`,
    "",
  ];

  if (lastContent) {
    lines.push("Your previous response was:");
    lines.push("```json");
    lines.push(lastContent.slice(0, 2_000));
    lines.push("```");
    lines.push("");
  }

  const msg = lastError.message;

  if (msg.includes("invalid JSON")) {
    lines.push(
      "INSTRUCTION: Return ONLY valid JSON. Do not wrap it in markdown code fences, do not add explanations before or after, and do not include any text outside the JSON object.",
      "The response must be a single JSON object matching the schema exactly."
    );
  } else if (msg.includes("missing string field")) {
    const fieldMatch = msg.match(/field (\w+)/);
    const field = fieldMatch?.[1] ?? "required";
    lines.push(
      `INSTRUCTION: The "${field}" field is missing or empty in one of the proposed tests.`,
      "Every test must have these non-empty string fields: name, kind, filePath, testCommand, content, rationale."
    );
  } else if (msg.includes("Unsupported proposed test kind")) {
    lines.push(
      'INSTRUCTION: The "kind" field must be exactly "fail_to_pass" or "pass_to_pass".',
      'Use "fail_to_pass" unless the evidence strongly requires a guard test.'
    );
  } else if (msg.includes("unsafe filePath")) {
    lines.push(
      "INSTRUCTION: The filePath must be a safe relative path inside the repository.",
      'Do not use absolute paths ("/"), parent directory references (".."), or null bytes.',
      'Example valid paths: "tests/test_example.py", "src/__tests__/utils.spec.ts"'
    );
  } else if (msg.includes("disallowed testCommand")) {
    lines.push(
      "INSTRUCTION: The testCommand must start with an allowed prefix.",
      "Allowed prefixes: pnpm, npm, yarn, npx, node, bun, pytest, python, go test, cargo test, mvn, gradle, ./gradlew",
      "The command is used to run the test file. Do not put test code inside the command string.",
      'Example: "pytest tests/test_example.py"'
    );
  } else if (msg.includes("proposedTests")) {
    lines.push(
      'INSTRUCTION: The response must include a top-level "proposedTests" array with at least one test object.',
      "Each test object must contain all required fields."
    );
  } else if (msg.includes("string notes")) {
    lines.push(
      'INSTRUCTION: The response must include a top-level "notes" array of strings.',
      "Add 1-3 short notes about your reasoning or assumptions."
    );
  } else if (msg.includes("transient error")) {
    lines.push(
      "INSTRUCTION: The previous request hit a transient API error. Please try again with the same approach."
    );
  } else if (msg.includes("empty content")) {
    lines.push(
      "INSTRUCTION: The model returned empty output. Please generate a complete JSON response matching the schema."
    );
  } else {
    lines.push(
      "INSTRUCTION: Return a valid JSON object matching the schema exactly.",
      "Keep each test file content under 120 lines and each rationale under 240 characters.",
      "Prefer exactly one fail_to_pass test."
    );
  }

  lines.push("");
  lines.push(
    `This is retry ${attempt - 1}/${maxAttempts - 1}. Make sure the JSON is valid and all fields are correct.`
  );

  return lines.join("\n");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createTestBuilderMessages(input: TestBuilderInput) {
  return [
    {
      role: "system",
      content: [
        "You propose executable SWE-bench-style regression tests from a GitHub issue and fixing PR.",
        "Return ONLY valid JSON. No markdown fences, no explanations outside the JSON.",
        "Propose exactly one fail_to_pass test unless the evidence strongly requires one pass_to_pass guard.",
        "Do not claim tests are validated. These are proposed tests only.",
        "Every test must include relative filePath, full file content, and shell testCommand.",
        "testCommand must start with: pnpm, npm, yarn, npx, node, bun, pytest, python, go test, cargo test, mvn, gradle, or ./gradlew.",
        "Never put code in testCommand.",
        "Keep each test file under 120 lines.",
        "Keep rationale fields under 240 characters.",
        "Prefer editing or adding a test near files changed by the PR.",
        "Use changedFiles.testCandidates, packageRoots, and commandHints to choose realistic paths and commands.",
      ].join(" "),
    },
    {
      role: "user",
      content: JSON.stringify(createCompactTestBuilderInput(input)),
    },
  ];
}

export function parseProposedTestBuilderCandidate(
  value: unknown,
): ProposedTestBuilderCandidate {
  if (!isRecord(value)) {
    throw new Error("Test builder response must be an object");
  }

  const proposedTests = value.proposedTests;
  const notes = value.notes;

  if (!Array.isArray(proposedTests) || proposedTests.length === 0) {
    throw new Error("Test builder response must include proposedTests");
  }

  if (!Array.isArray(notes) || !notes.every((note) => typeof note === "string")) {
    throw new Error("Test builder response must include string notes");
  }

  const candidate: ProposedTestBuilderCandidate = {
    schemaVersion: "pilab.test-builder.proposal.v1",
    proposedTests: proposedTests.map(parseProposedTestSpec),
    notes,
  };

  const existingTestsFound = value.existingTestsFound;
  if (typeof existingTestsFound === "boolean") {
    candidate.existingTestsFound = existingTestsFound;
  }

  const behavioralReproduction = value.behavioralReproduction;
  if (isRecord(behavioralReproduction)) {
    const script = behavioralReproduction.script;
    const rationale = behavioralReproduction.rationale;
    if (typeof script === "string" && typeof rationale === "string") {
      candidate.behavioralReproduction = { script, rationale };
    }
  }

  return candidate;
}

function parseProposedTestSpec(value: unknown): ProposedTestSpec {
  if (!isRecord(value)) {
    throw new Error("Proposed test must be an object");
  }

  const name = readString(value, "name");
  const kind = readString(value, "kind");
  const testCommand = readString(value, "testCommand");
  const rationale = readString(value, "rationale");

  if (kind !== "fail_to_pass" && kind !== "pass_to_pass") {
    throw new Error(`Unsupported proposed test kind: ${kind}`);
  }

  const filePath = normalizeProposedFilePath(readString(value, "filePath"));
  const content = readString(value, "content");

  assertSafeRelativeFilePath(filePath);
  assertAllowedTestCommand(testCommand);

  const spec: ProposedTestSpec = {
    name,
    kind,
    filePath,
    testCommand,
    content,
    rationale,
  };

  copyOptionalString(value, spec, "expectedFailureMode");
  copyOptionalString(value, spec, "expectedPassMode");

  return spec;
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
  const filenames = changedFiles
    .map((file) => readOptionalString(file, "filename"))
    .filter((file): file is string => Boolean(file));
  const testCandidates = filenames.filter(isLikelyTestFile).slice(0, 10);
  const sourceCandidates = filenames.filter((file) => !isLikelyTestFile(file)).slice(0, 12);
  const packageRoots = inferPackageRoots(filenames);
  const commandHints = inferCommandHints(filenames, packageRoots);

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
      url: readOptionalString(pullRequest, "html_url") ??
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
      changedFiles: {
        all: changedFiles.map(summarizeChangedFileForPrompt),
        sourceCandidates,
        testCandidates,
        packageRoots,
        commandHints,
      },
    },
    instructions: {
      output: "exactly one compact executable proposed test is preferred",
      validation: "fail_to_pass must fail on base and pass on gold",
    },
    previousAttemptLogs: input.previousAttemptLogs
      ? JSON.stringify(input.previousAttemptLogs).slice(0, 3_000)
      : null,
  };
}

function summarizeChangedFileForPrompt(file: Record<string, unknown>) {
  return {
    filename: readOptionalString(file, "filename"),
    status: readOptionalString(file, "status"),
    additions: readOptionalNumber(file, "additions"),
    deletions: readOptionalNumber(file, "deletions"),
    changes: readOptionalNumber(file, "changes"),
    patch: truncate(readOptionalString(file, "patch"), 6_000),
  };
}

function inferPackageRoots(filenames: string[]): string[] {
  const roots = new Set<string>();

  for (const filename of filenames) {
    const parts = filename.split("/");
    if (parts[0] === "packages" && parts.length >= 2) {
      roots.add(parts.slice(0, 2).join("/"));
    } else if (parts[0] === "apps" && parts.length >= 2) {
      roots.add(parts.slice(0, 2).join("/"));
    } else if (parts.length > 1) {
      roots.add(parts[0] ?? ".");
    } else {
      roots.add(".");
    }
  }

  return [...roots].slice(0, 8);
}

function inferCommandHints(filenames: string[], packageRoots: string[]): string[] {
  const hints = new Set<string>();
  const hasJs = filenames.some((file) => /\.(js|jsx|ts|tsx|mjs|cjs)$/.test(file));
  const hasPython = filenames.some((file) => /\.py$/.test(file));
  const hasGo = filenames.some((file) => /\.go$/.test(file));
  const hasRust = filenames.some((file) => /\.rs$/.test(file));

  if (hasJs) {
    hints.add("yarn test <test-file-or-suite>");
    hints.add("pnpm test <test-file-or-suite>");
    for (const root of packageRoots.filter((item) => item !== ".").slice(0, 4)) {
      hints.add(`yarn test ${root}`);
    }
  }

  if (hasPython) {
    hints.add("pytest <test-file>");
  }

  if (hasGo) {
    hints.add("go test ./...");
  }

  if (hasRust) {
    hints.add("cargo test");
  }

  return [...hints].slice(0, 10);
}

function isLikelyTestFile(filename: string): boolean {
  return /(^|\/)(__tests__|tests?|spec)\//.test(filename) ||
    /\.(test|spec)\.(js|jsx|ts|tsx|mjs|cjs|py)$/.test(filename) ||
    /Test\.(java|kt|scala)$/.test(filename) ||
    /_test\.go$/.test(filename);
}

function readRecord(value: unknown, key: string): Record<string, unknown> {
  if (!isRecord(value)) {
    return {};
  }

  const item = value[key];
  return isRecord(item) ? item : {};
}

function readArray(value: unknown, key: string): unknown[] {
  if (!isRecord(value)) {
    return [];
  }

  const item = value[key];
  return Array.isArray(item) ? item : [];
}

function readOptionalString(value: unknown, key: string): string | null {
  if (!isRecord(value)) {
    return null;
  }

  const item = value[key];
  return typeof item === "string" && item.length > 0 ? item : null;
}

function readOptionalNumber(value: unknown, key: string): number | null {
  if (!isRecord(value)) {
    return null;
  }

  const item = value[key];
  return typeof item === "number" && Number.isFinite(item) ? item : null;
}

function truncate(value: string | null, maxLength: number): string | null {
  if (!value || value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}...`;
}

function parseJsonObject(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch (error) {
    throw new Error(
      `Test builder returned invalid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function readString(value: Record<string, unknown>, key: string): string {
  const item = value[key];

  if (typeof item !== "string" || item.trim().length === 0) {
    throw new Error(`Proposed test is missing string field ${key}`);
  }

  return item;
}

function copyOptionalString<T extends Record<string, unknown>>(
  source: Record<string, unknown>,
  target: T,
  key: string,
) {
  const value = source[key];

  if (typeof value === "string" && value.length > 0) {
    target[key as keyof T] = value as T[keyof T];
  }
}

function assertSafeRelativeFilePath(filePath: string) {
  if (
    filePath.startsWith("/") ||
    filePath.startsWith("\\") ||
    filePath.includes("..") ||
    filePath.includes("\0")
  ) {
    throw new Error(`Proposed test has unsafe filePath: ${filePath}`);
  }
}

function normalizeProposedFilePath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const repoMarker = "/repo/";
  const repoIndex = normalized.lastIndexOf(repoMarker);

  if (repoIndex >= 0) {
    return normalized.slice(repoIndex + repoMarker.length);
  }

  return normalized;
}

function assertAllowedTestCommand(command: string) {
  const trimmed = command.trim();
  const allowed = [
    "pnpm ",
    "npm ",
    "yarn ",
    "npx ",
    "node ",
    "bun ",
    "pytest",
    "python ",
    "go test",
    "cargo test",
    "mvn ",
    "gradle ",
    "./gradlew",
  ].some((prefix) => trimmed === prefix.trim() || trimmed.startsWith(prefix));

  if (!allowed) {
    throw new Error(`Proposed test has disallowed testCommand: ${command}`);
  }
}

function toJsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
