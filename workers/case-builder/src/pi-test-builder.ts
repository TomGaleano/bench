import type { JsonValue } from "@pilab/object-store";
import {
  addWorktree,
  buildPeerSystemPrompt,
  createBenchmarkRuntime,
  runSandboxPiAgent,
  shellQuote,
  writeSeedFile,
  type RuntimeProvider,
  type RuntimeWorkspace,
} from "@pilab/runtime";
import type {
  ProposedTestBuilderCandidate,
  ProposedTestKind,
  ProposedTestSpec,
  TestBuilderInput,
  TestBuilderRun,
} from "./test-builder-types.js";
import { parseProposedTestBuilderCandidate } from "./test-builder-types.js";

export type PiTestBuilderConfig = {
  apiKey: string;
  modelId: string;
  provider?: string;
  maxWallClockSeconds?: number;
};

const REPO_ROOT = "/home/user/repo";
const WORKTREE_BRANCH = "test-builder";
const WORKTREE_PATH = `${REPO_ROOT}-test-builder`;
const OUTPUT_FILENAME = "test-builder-output.json";

/**
 * Test-builder agent that runs inside an E2B sandbox with the repo cloned at
 * base + gold commits. Replaces the prior local-tmpdir + raw-OpenRouter
 * implementation so the agent can actually inspect the codebase and run
 * candidate tests against both commits before declaring them done.
 */
export function createPiTestBuilder(config: PiTestBuilderConfig) {
  const provider = config.provider ?? "openrouter";
  const maxWallClockSeconds = config.maxWallClockSeconds ?? 600;

  return {
    async build(input: TestBuilderInput): Promise<TestBuilderRun> {
      const requestedAt = new Date().toISOString();
      const repoMeta = extractRepoMetadata(input);

      if (!repoMeta.repoUrl || !repoMeta.baseCommit || !repoMeta.goldCommit) {
        throw new Error(
          "Pi test builder requires a repository URL, base commit, and gold commit",
        );
      }

      const runtime: RuntimeProvider = createBenchmarkRuntime();
      const workspace: RuntimeWorkspace = await runtime.createWorkspace({
        id: `test-builder-${randomSuffix()}`,
        timeoutMs: (maxWallClockSeconds + 120) * 1000,
      });

      try {
        await initRepoWithBaseAndGold({
          workspace,
          root: REPO_ROOT,
          repoUrl: repoMeta.repoUrl,
          baseCommit: repoMeta.baseCommit,
          goldCommit: repoMeta.goldCommit,
        });

        await addWorktree({
          workspace,
          root: REPO_ROOT,
          branch: WORKTREE_BRANCH,
          worktreePath: WORKTREE_PATH,
          baseRef: "base",
        });

        const contextMd = renderContextDoc(input, repoMeta);
        await writeSeedFile({
          workspace,
          worktreePath: WORKTREE_PATH,
          seedText: contextMd,
          fileName: "CONTEXT.md",
        });

        const priorMd = renderPriorAttemptsDoc(input.previousAttemptLogs);
        const hasPrior = priorMd !== null;
        if (hasPrior) {
          await writeSeedFile({
            workspace,
            worktreePath: WORKTREE_PATH,
            seedText: priorMd,
            fileName: "PRIOR_ATTEMPTS.md",
          });
        }

        const extra = [
          `Read CONTEXT.md in this directory first — it has the issue, PR metadata, and the gold patch diff.`,
          `The shared repository at ${REPO_ROOT} has two branches: \`base\` (this worktree's branch is forked from it) and \`gold\` (the merged PR). Use \`git -C ${REPO_ROOT} diff base..gold\` if you need the full diff text.`,
          `You can verify a candidate test by running it from a temporary checkout of base/gold. The simplest pattern: add another worktree (\`git -C ${REPO_ROOT} worktree add /tmp/base-check base\`) and run your test against it; expect the fail-to-pass tests to FAIL on base and PASS on gold.`,
          hasPrior
            ? `PRIOR_ATTEMPTS.md summarizes the previous attempts that the validation runner rejected. Read it and avoid the same failure modes.`
            : "",
        ]
          .filter((line) => line.length > 0)
          .join("\n\n");

        const systemPrompt = buildPeerSystemPrompt({
          role: "test_builder",
          modelName: config.modelId,
          agentIndex: 0,
          totalAgents: 1,
          peers: [],
          worktreePath: WORKTREE_PATH,
          branch: WORKTREE_BRANCH,
          extra,
        });

        const userPrompt = [
          `Propose fail-to-pass / pass-to-pass tests for this case.`,
          `Write the final result to \`${WORKTREE_PATH}/${OUTPUT_FILENAME}\` as JSON with shape:`,
          "```json",
          `{`,
          `  "failToPass": [{ "name": "...", "filePath": "...", "testCommand": "...", "content": "...", "rationale": "..." }],`,
          `  "passToPass": [{ "name": "...", "filePath": "...", "testCommand": "...", "content": "...", "rationale": "..." }],`,
          `  "notes": ["..."]`,
          `}`,
          "```",
          `Each \`testCommand\` must be one of pytest, jest, vitest, npm/yarn/pnpm test, or go test. Paths must be relative to the repo root. After writing the file, output your usual FINAL: summary.`,
        ].join("\n");

        const controller = new AbortController();
        const events: unknown[] = [];

        await runSandboxPiAgent({
          workspace,
          runId: `test-builder-${randomSuffix()}`,
          provider,
          modelName: config.modelId,
          prompt: userPrompt,
          systemPrompt,
          apiKey: config.apiKey,
          tools: ["read", "write", "edit", "grep", "find", "ls", "bash"],
          timeoutMs: maxWallClockSeconds * 1000,
          signal: controller.signal,
          cwd: WORKTREE_PATH,
          followUpInboxPath: null,
          onEvent: (event) => {
            events.push(event);
          },
        });

        const outputPath = `${WORKTREE_PATH}/${OUTPUT_FILENAME}`;
        let rawOutput: string;
        try {
          rawOutput = await workspace.readFile(outputPath);
        } catch (err) {
          throw new Error(
            `Pi test builder did not produce ${OUTPUT_FILENAME}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }

        let parsedOutput: unknown;
        try {
          parsedOutput = JSON.parse(rawOutput);
        } catch (err) {
          throw new Error(
            `Pi test builder output is not valid JSON: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }

        const candidate = parseProposedTestBuilderCandidate(
          normalizeAgentOutput(parsedOutput),
        );

        return {
          modelId: config.modelId,
          requestedAt,
          completedAt: new Date().toISOString(),
          candidate,
          rawResponse: parsedOutput as JsonValue,
          attempts: 1,
        };
      } finally {
        await workspace.delete().catch(() => undefined);
      }
    },
  };
}

// ── Repo setup ──────────────────────────────────────────────────────────────

async function initRepoWithBaseAndGold(input: {
  workspace: RuntimeWorkspace;
  root: string;
  repoUrl: string;
  baseCommit: string;
  goldCommit: string;
}): Promise<void> {
  const { workspace, root, repoUrl, baseCommit, goldCommit } = input;
  const result = await workspace.run({
    command: [
      `mkdir -p ${shellQuote(root)}`,
      `git init -q ${shellQuote(root)}`,
      `git -C ${shellQuote(root)} config user.email test-builder@pilab`,
      `git -C ${shellQuote(root)} config user.name test-builder`,
      `git -C ${shellQuote(root)} remote add origin ${shellQuote(repoUrl)} 2>/dev/null || git -C ${shellQuote(root)} remote set-url origin ${shellQuote(repoUrl)}`,
      `git -C ${shellQuote(root)} fetch --depth=1 origin ${shellQuote(baseCommit)}`,
      `git -C ${shellQuote(root)} checkout -B base ${shellQuote(baseCommit)}`,
      `git -C ${shellQuote(root)} fetch --depth=1 origin ${shellQuote(goldCommit)}`,
      `git -C ${shellQuote(root)} branch -f gold ${shellQuote(goldCommit)}`,
    ].join(" && "),
    timeoutMs: 300_000,
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `Failed to initialize test-builder repo at base+gold: ${result.stderr || result.stdout}`,
    );
  }
}

// ── Context rendering ───────────────────────────────────────────────────────

type RepoMetadata = {
  repoUrl: string | null;
  repoOwner: string | null;
  repoName: string | null;
  baseCommit: string | null;
  goldCommit: string | null;
  issueTitle: string | null;
  issueBody: string | null;
  issueNumber: number | null;
  prTitle: string | null;
  prBody: string | null;
  prNumber: number | null;
  changedFiles: Array<{ filename: string; patch?: string; status?: string }>;
};

function extractRepoMetadata(input: TestBuilderInput): RepoMetadata {
  const repo = readRecord(input.repositoryMetadataArtifact, "repository");
  const base = readRecord(input.repositoryMetadataArtifact, "base");
  const head = readRecord(input.repositoryMetadataArtifact, "head");
  const changedFilesRaw = readArray(input.repositoryMetadataArtifact, "changedFiles");
  const issue = readRecord(input.issueArtifact, "issue");
  const pr = readRecord(input.pullRequestArtifact, "pullRequest");

  const owner = readOptionalString(repo, "owner") ?? null;
  const name = readOptionalString(repo, "name") ?? null;
  const repoUrl =
    owner && name ? `https://github.com/${owner}/${name}.git` : null;
  const baseSha = readOptionalString(base, "sha") ?? null;
  const headSha =
    readOptionalString(repo, "mergeSha") ??
    readOptionalString(head, "sha") ??
    null;

  return {
    repoUrl,
    repoOwner: owner,
    repoName: name,
    baseCommit: baseSha,
    goldCommit: headSha,
    issueTitle: readOptionalString(issue, "title") ?? null,
    issueBody: readOptionalString(issue, "body") ?? null,
    issueNumber: readOptionalNumber(issue, "number"),
    prTitle: readOptionalString(pr, "title") ?? null,
    prBody: readOptionalString(pr, "body") ?? null,
    prNumber: readOptionalNumber(pr, "number"),
    changedFiles: changedFilesRaw
      .filter(isRecord)
      .map((file) => {
        const filename = readOptionalString(file, "filename");
        if (!filename) return null;
        const entry: { filename: string; patch?: string; status?: string } = {
          filename,
        };
        const patch = readOptionalString(file, "patch");
        if (patch) entry.patch = patch;
        const status = readOptionalString(file, "status");
        if (status) entry.status = status;
        return entry;
      })
      .filter((file): file is { filename: string; patch?: string; status?: string } =>
        Boolean(file),
      ),
  };
}

function renderContextDoc(input: TestBuilderInput, meta: RepoMetadata): string {
  const lines: string[] = [
    `# Test-Builder Context`,
    ``,
    `**Repository:** ${meta.repoOwner ?? "?"}/${meta.repoName ?? "?"}`,
    `**Base commit:** \`${meta.baseCommit ?? "?"}\``,
    `**Gold commit:** \`${meta.goldCommit ?? "?"}\``,
    ``,
    `## Issue${meta.issueNumber ? ` #${meta.issueNumber}` : ""}: ${meta.issueTitle ?? "(no title)"}`,
    ``,
    truncate(meta.issueBody ?? "(no body)", 6_000),
    ``,
    `## Pull request${meta.prNumber ? ` #${meta.prNumber}` : ""}: ${meta.prTitle ?? "(no title)"}`,
    ``,
    truncate(meta.prBody ?? "(no body)", 4_000),
    ``,
    `## Changed files`,
    ``,
  ];

  if (meta.changedFiles.length === 0) {
    lines.push("_(no changed-file metadata available)_");
  } else {
    for (const file of meta.changedFiles.slice(0, 25)) {
      lines.push(`### \`${file.filename}\`${file.status ? ` (${file.status})` : ""}`);
      if (file.patch) {
        lines.push("```diff");
        lines.push(truncate(file.patch, 4_000));
        lines.push("```");
      }
      lines.push("");
    }
  }

  if (isRecord(input.testPatchArtifact)) {
    const testPatch = readOptionalString(input.testPatchArtifact, "testPatch");
    if (testPatch) {
      lines.push(`## Existing test patch (from the PR)`);
      lines.push("```diff");
      lines.push(truncate(testPatch, 4_000));
      lines.push("```");
      lines.push("");
      lines.push(`_Prefer reusing or adapting these existing tests when applicable._`);
      lines.push("");
    }
  }

  return lines.join("\n");
}

function renderPriorAttemptsDoc(logs: JsonValue | undefined): string | null {
  if (!logs || !isRecord(logs)) return null;

  const lines: string[] = [
    `# Prior Test-Generation Attempts`,
    ``,
    `Earlier attempts produced tests that the validation runner rejected. Read the rejection reasons and avoid the same failure modes.`,
    ``,
  ];

  const tests = readArray(logs, "tests").filter(isRecord);
  const rejected = tests.filter((t) => readOptionalString(t, "status") === "rejected");

  if (rejected.length > 0) {
    lines.push(`## Rejected tests (${rejected.length})`);
    lines.push(``);
    for (const t of rejected.slice(0, 20)) {
      const name = readOptionalString(t, "name") ?? "(unnamed)";
      const kind = readOptionalString(t, "kind") ?? "?";
      const issues = readArray(t, "issues").filter(isRecord);
      lines.push(`- **${name}** (${kind})`);
      for (const issue of issues.slice(0, 5)) {
        const code = readOptionalString(issue, "code") ?? "issue";
        const message = readOptionalString(issue, "message") ?? "(no message)";
        lines.push(`  - \`${code}\`: ${message}`);
      }
    }
    lines.push(``);
  }

  const testPatchResults = readRecord(logs, "testPatchResults");
  if (testPatchResults) {
    const f2p = readArray(testPatchResults, "failToPassTests");
    const p2p = readArray(testPatchResults, "passToPassTests");
    if (f2p.length > 0 || p2p.length > 0) {
      lines.push(`## Test-patch results from the prior attempt`);
      lines.push(`- fail-to-pass tests that worked: ${f2p.length}`);
      lines.push(`- pass-to-pass tests that worked: ${p2p.length}`);
      lines.push(``);
    }
  }

  return lines.length > 4 ? lines.join("\n") : null;
}

// ── Output normalization ────────────────────────────────────────────────────

/**
 * The agent writes `{ failToPass: [...], passToPass: [...], notes?: [...] }`
 * (the shape we documented in the prompt). The downstream parser expects
 * `{ proposedTests: [...], notes: [...] }` with each test carrying its own
 * `kind`. Combine the two arrays here.
 */
function normalizeAgentOutput(value: unknown): unknown {
  if (!isRecord(value)) {
    throw new Error("Agent output must be a JSON object");
  }

  // Already in the parser's expected shape — pass through.
  if (Array.isArray(value.proposedTests)) {
    return value;
  }

  const failToPass = readArray(value, "failToPass");
  const passToPass = readArray(value, "passToPass");
  const notes = readArray(value, "notes")
    .filter((note): note is string => typeof note === "string");

  const proposedTests: Array<Record<string, unknown>> = [];
  for (const t of failToPass) {
    if (isRecord(t)) proposedTests.push(annotateKind(t, "fail_to_pass"));
  }
  for (const t of passToPass) {
    if (isRecord(t)) proposedTests.push(annotateKind(t, "pass_to_pass"));
  }

  if (proposedTests.length === 0) {
    throw new Error(
      "Agent output has neither `proposedTests` nor `failToPass`/`passToPass` arrays",
    );
  }

  return { proposedTests, notes } satisfies {
    proposedTests: Array<Record<string, unknown>>;
    notes: string[];
  };
}

function annotateKind(
  test: Record<string, unknown>,
  kind: ProposedTestKind,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...test, kind };
  if (typeof out.name !== "string" || out.name.length === 0) {
    const filePath = typeof out.filePath === "string" ? out.filePath : "unnamed";
    out.name = `${kind}:${filePath}`;
  }
  return out;
}

// ── Tiny JSON-value readers (no external dep) ───────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRecord(value: unknown, key: string): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  const inner = value[key];
  return isRecord(inner) ? inner : undefined;
}

function readArray(value: unknown, key: string): unknown[] {
  if (!isRecord(value)) return [];
  const inner = value[key];
  return Array.isArray(inner) ? inner : [];
}

function readOptionalString(
  value: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  if (!value) return undefined;
  const inner = value[key];
  return typeof inner === "string" ? inner : undefined;
}

function readOptionalNumber(
  value: Record<string, unknown> | undefined,
  key: string,
): number | null {
  if (!value) return null;
  const inner = value[key];
  return typeof inner === "number" && Number.isFinite(inner) ? inner : null;
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}\n…(truncated, ${value.length - max} more chars)`;
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 10);
}

// Silence unused-export lint for the imported types we re-expose to make the
// signature self-documenting.
export type { ProposedTestBuilderCandidate, ProposedTestSpec, TestBuilderRun };
