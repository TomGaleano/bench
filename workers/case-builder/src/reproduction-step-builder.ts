import type { JsonValue } from "@pilab/object-store";

export type ReproductionStep = {
  description: string;
  command: string;
};

export type ReproductionStepBuilderCandidate = {
  schemaVersion: "pilab.reproduction-steps.v1";
  steps: ReproductionStep[];
  script: string;
  rationale: string;
  notes: string[];
};

export type ReproductionStepBuilderInput = {
  issueArtifact: JsonValue;
  pullRequestArtifact: JsonValue;
  repositoryMetadataArtifact: JsonValue;
  previousAttemptLogs?: JsonValue;
};

export type ReproductionStepBuilderRun = {
  modelId: string;
  requestedAt: string;
  completedAt: string;
  candidate: ReproductionStepBuilderCandidate;
  rawResponse: JsonValue;
  attempts: number;
};

export type ReproductionStepBuilderConfig = {
  apiKey: string;
  modelId: string;
  fetchImpl?: typeof fetch;
  maxAttempts?: number;
};

type OpenRouterChatResponse = {
  model?: string;
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  error?: {
    message?: string;
  };
};

function toJsonValue(value: unknown): JsonValue {
  return value as JsonValue;
}

export function createReproductionStepBuilder(config: ReproductionStepBuilderConfig) {
  const maxAttempts = config.maxAttempts ?? 3;

  return {
    async build(input: ReproductionStepBuilderInput): Promise<ReproductionStepBuilderRun> {
      const requestedAt = new Date().toISOString();
      let lastError: Error | null = null;
      let lastContent: string | null = null;
      let lastRawResponse: JsonValue = null;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const messages = createReproductionStepBuilderMessages(input, attempt, maxAttempts, lastError, lastContent);

        const response = await (config.fetchImpl ?? fetch)("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: config.modelId,
            messages,
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
          const errorMessage = rawResponse.error?.message ?? `HTTP ${response.status}`;

          if (isRetryable && attempt < maxAttempts) {
            lastError = new Error(`OpenRouter transient error (${response.status}): ${errorMessage}`);
            await delay(1_000 * attempt);
            continue;
          }

          throw new Error(`OpenRouter reproduction step builder failed with HTTP ${response.status}: ${errorMessage}`);
        }

        const content = rawResponse.choices?.[0]?.message?.content;

        if (!content) {
          if (attempt < maxAttempts) {
            lastError = new Error("OpenRouter reproduction step builder returned empty content");
            await delay(500);
            continue;
          }
          throw new Error("OpenRouter reproduction step builder returned no message content");
        }

        lastContent = content;

        try {
          const parsed = parseJsonObject(content);
          const candidate = parseReproductionStepBuilderCandidate(parsed);

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

      throw lastError ?? new Error("OpenRouter reproduction step builder failed after all retries");
    },
  };
}

function createReproductionStepBuilderMessages(
  input: ReproductionStepBuilderInput,
  attempt: number,
  maxAttempts: number,
  lastError: Error | null,
  lastContent: string | null,
): Array<{ role: string; content: string }> {
  const systemContent = [
    "You are an expert software engineer tasked with creating a reproducible bash script for a GitHub issue.",
    "The previous attempts to write unit tests failed validation. Now you must produce a behavioral reproduction.",
    "Return ONLY valid JSON. No markdown fences, no explanations outside the JSON.",
    "The script must be a self-contained bash script that:",
    "1. Installs dependencies if needed.",
    "2. Starts the application/service (e.g., npm run dev, python manage.py runserver, cargo run).",
    "3. Interacts with it via curl, wget, or CLI commands to trigger the buggy behavior.",
    "4. Exits with code 0 if the bug is FIXED (no error), and non-zero if the bug is PRESENT.",
    "Use background processes (e.g., & and wait) if the service needs to stay running during interaction.",
    "The script must work inside a cloned repository directory.",
    "Keep the script under 120 lines and comments concise.",
    "The JSON schema is {\"steps\":[{\"description\":string,\"command\":string}],\"script\":string,\"rationale\":string,\"notes\":string[]}.",
    "If the reproduction is a config or CLI check rather than a long-running service, provide bash commands that inspect files or run the relevant CLI and preserve the same exit-code contract.",
  ].join(" ");

  const userContent: string[] = [];

  if (lastError && attempt > 1) {
    userContent.push(`ATTEMPT ${attempt - 1} of ${maxAttempts} failed.`);
    userContent.push(`Error: ${lastError.message}`);
    if (lastContent) {
      userContent.push("Your previous response was:");
      userContent.push("```json");
      userContent.push(lastContent.slice(0, 2_000));
      userContent.push("```");
    }
    userContent.push("INSTRUCTION: Return a valid JSON object matching the schema exactly.");
    userContent.push("");
  }

  if (input.previousAttemptLogs) {
    userContent.push("Previous validation attempt logs:");
    userContent.push(JSON.stringify(input.previousAttemptLogs).slice(0, 3_000));
    userContent.push("");
  }

  userContent.push(JSON.stringify(createCompactReproductionStepBuilderInput(input)));

  return [
    { role: "system", content: systemContent },
    { role: "user", content: userContent.join("\n") },
  ];
}

function createCompactReproductionStepBuilderInput(input: ReproductionStepBuilderInput) {
  const issue = readRecord(input.issueArtifact, "issue");
  const pullRequest = readRecord(input.pullRequestArtifact, "pullRequest");
  const repository = readRecord(input.repositoryMetadataArtifact, "repository");

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
      url: readOptionalString(pullRequest, "html_url") ?? readOptionalString(pullRequest, "url"),
      baseRef: readOptionalString(readRecord(pullRequest, "base"), "ref"),
      headRef: readOptionalString(readRecord(pullRequest, "head"), "ref"),
    },
    repository: {
      owner: readOptionalString(repository, "owner"),
      name: readOptionalString(repository, "name"),
      language: readOptionalString(repository, "language"),
      mergeSha: readOptionalString(input.repositoryMetadataArtifact, "mergeSha"),
    },
  };
}

export function parseReproductionStepBuilderCandidate(value: unknown): ReproductionStepBuilderCandidate {
  if (!isRecord(value)) {
    throw new Error("Reproduction step builder response must be an object");
  }

  const steps = value.steps;
  const script = value.script;
  const rationale = value.rationale;
  const notes = value.notes;

  if (typeof script !== "string" || script.trim().length === 0) {
    throw new Error("Reproduction step builder response must include a non-empty script string");
  }

  if (notes !== undefined && (!Array.isArray(notes) || !notes.every((note) => typeof note === "string"))) {
    throw new Error("Reproduction step builder response must include string notes");
  }

  const parsedSteps: ReproductionStep[] = Array.isArray(steps) ? steps.map((step) => {
    if (!isRecord(step)) {
      throw new Error("Each step must be an object");
    }
    const description = step.description;
    const command = step.command;
    if (typeof description !== "string" || typeof command !== "string") {
      throw new Error("Each step must have description and command strings");
    }
    return { description, command };
  }) : [];

  const finalSteps = parsedSteps.length > 0 ? parsedSteps : deriveStepsFromScript(script);

  if (finalSteps.length === 0) {
    throw new Error("Reproduction step builder response must include steps or a script with executable commands");
  }

  return {
    schemaVersion: "pilab.reproduction-steps.v1",
    steps: finalSteps,
    script,
    rationale: typeof rationale === "string" && rationale.trim().length > 0
      ? rationale
      : "Generated from a bash reproduction script after unit-test validation failed.",
    notes: Array.isArray(notes) ? notes : [],
  };
}

function deriveStepsFromScript(script: string): ReproductionStep[] {
  return script
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#") && !line.startsWith("set "))
    .slice(0, 12)
    .map((command, index) => ({
      description: `Run reproduction command ${index + 1}`,
      command,
    }));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseJsonObject(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch (error) {
    throw new Error(
      `Reproduction step builder returned invalid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRecord(value: unknown, key: string): Record<string, unknown> {
  if (!isRecord(value)) {
    return {};
  }
  const item = value[key];
  return isRecord(item) ? item : {};
}

function readOptionalString(value: unknown, key: string): string | null {
  if (!isRecord(value)) {
    return null;
  }
  const item = value[key];
  return typeof item === "string" && item.length > 0 ? item : null;
}

function truncate(value: string | null, maxLength: number): string | null {
  if (!value || value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}...`;
}
