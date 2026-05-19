export type GraderInput = {
  issueDescription: string;
  patchDiff: string;
  apiKey: string;
  modelId: string;
  fetchImpl?: typeof fetch;
};

export type ValidationGraderInput = {
  issueTitle?: string;
  issueBody?: string;
  patchDiff: string;
  baseCode?: string;
  goldCode?: string;
  apiKey: string;
  modelId: string;
  fetchImpl?: typeof fetch;
};

export type GraderResult = {
  correctness: number;
  completeness: number;
  safety: number;
  score: number;
  reasoning: string;
};

const gradeSchema = {
  type: "object",
  properties: {
    correctness: { type: "number" },
    completeness: { type: "number" },
    safety: { type: "number" },
    score: { type: "number" },
    reasoning: { type: "string" },
  },
  required: ["correctness", "completeness", "safety", "score", "reasoning"],
  additionalProperties: false,
} as const;

const SYSTEM_PROMPT = `You are an expert software engineering grader. Evaluate whether a patch correctly fixes an issue using the following structured rubric:

- Correctness (0-100): Does the patch actually fix the described issue? Is the logic sound and does it address the root cause?
- Completeness (0-100): Does the patch handle edge cases, error conditions, and related scenarios? Or does it fix only the narrow case?
- Safety (0-100): Does the patch avoid breaking existing functionality, introducing regressions, or adding unnecessary side effects?
- Overall (0-100): Weighted average of the above. Correctness is most important, followed by safety and completeness.

For each dimension, provide a score between 0 and 100. In your reasoning, explain your assessment for each dimension, cite specific lines from the diff where relevant, and note any concerns.

Respond with JSON matching the provided schema.`;

function buildPrompt(input: GraderInput | ValidationGraderInput): string {
  const isLegacy = "issueDescription" in input;

  let issueSection: string;
  if (isLegacy) {
    issueSection = `Issue Description:\n${input.issueDescription}`;
  } else {
    const parts: string[] = [];
    if (input.issueTitle) parts.push(`Title: ${input.issueTitle}`);
    if (input.issueBody) parts.push(`Body: ${input.issueBody}`);
    issueSection = `Issue:\n${parts.join("\n") || "No issue description provided."}`;
  }

  const sections: string[] = [issueSection];

  if (!isLegacy && input.baseCode) {
    sections.push(`Base Code (before fix):\n\`\`\`\n${input.baseCode}\n\`\`\``);
  }

  if (!isLegacy && input.goldCode) {
    sections.push(`Gold Code (expected fix):\n\`\`\`\n${input.goldCode}\n\`\`\``);
  }

  sections.push(`Patch Diff:\n\`\`\`diff\n${input.patchDiff}\n\`\`\``);

  return sections.join("\n\n");
}

async function callGraderAPI(
  input: GraderInput | ValidationGraderInput,
  fetchImpl: typeof fetch,
): Promise<GraderResult> {
  const response = await fetchImpl("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: input.modelId,
      messages: [
        {
          role: "system",
          content: SYSTEM_PROMPT,
        },
        {
          role: "user",
          content: buildPrompt(input),
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "patch_grade",
          strict: true,
          schema: gradeSchema,
        },
      },
      temperature: 0,
    }),
  });

  const raw = (await response.json()) as unknown;
  if (!response.ok) {
    throw new Error(`Grader API error: ${extractErrorMessage(raw)}`);
  }

  const content = extractContent(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("Grader returned malformed JSON");
  }

  if (!isValidGraderResult(parsed)) {
    throw new Error("Grader returned invalid JSON schema");
  }

  return parsed;
}

export async function gradePatch(
  input: GraderInput | ValidationGraderInput,
): Promise<GraderResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const maxAttempts = 2;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await callGraderAPI(input, fetchImpl);
      console.log(`[grader] Grading succeeded on attempt ${attempt}`);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[grader] Grading failed on attempt ${attempt}: ${message}`);
      if (attempt === maxAttempts) {
        throw error;
      }
      console.log(`[grader] Retrying...`);
    }
  }

  throw new Error("Grader failed after max attempts");
}

function extractErrorMessage(value: unknown): string {
  if (
    isRecord(value) &&
    isRecord(value.error) &&
    typeof value.error.message === "string"
  ) {
    return value.error.message;
  }
  return "Unknown error";
}

function extractContent(value: unknown): string {
  if (!isRecord(value)) return "";
  const choices = value.choices;
  if (!Array.isArray(choices) || choices.length === 0) return "";
  const first = choices[0];
  if (!isRecord(first)) return "";
  const message = first.message;
  if (!isRecord(message)) return "";
  return typeof message.content === "string" ? message.content : "";
}

function isValidGraderResult(value: unknown): value is GraderResult {
  if (!isRecord(value)) return false;
  if (typeof value.correctness !== "number") return false;
  if (typeof value.completeness !== "number") return false;
  if (typeof value.safety !== "number") return false;
  if (typeof value.score !== "number") return false;
  if (typeof value.reasoning !== "string") return false;
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
