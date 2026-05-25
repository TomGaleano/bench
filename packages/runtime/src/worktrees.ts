import { shellQuote, type RuntimeWorkspace } from "./index.js";

/** Bootstrap a shared git repo at `root` with a single initial commit. */
export async function bootstrapSharedRepo(input: {
  workspace: RuntimeWorkspace;
  root: string;
  description?: string;
  userEmail?: string;
  userName?: string;
}): Promise<void> {
  const { workspace, root } = input;
  const email = input.userEmail ?? "agent-runtime@pilab";
  const name = input.userName ?? "agent-runtime";
  const desc = input.description ?? "shared agent-runtime repo";
  const result = await workspace.run({
    command: [
      `mkdir -p ${shellQuote(root)}`,
      `cd ${shellQuote(root)}`,
      `git init -q`,
      `git config user.email ${shellQuote(email)}`,
      `git config user.name ${shellQuote(name)}`,
      `echo ${shellQuote("# " + desc)} > README.md`,
      `git add README.md`,
      `git commit -q -m init`,
    ].join(" && "),
    timeoutMs: 30_000,
  });
  if (result.exitCode !== 0) {
    throw new Error(`Failed to bootstrap shared repo: ${result.stderr || result.stdout}`);
  }
}

/**
 * Initialize a shared repo at `root` from a remote `repoUrl` checked out at `commitSha`.
 * The commit is checked out as branch `baseRefName` so worktrees can branch off it.
 */
export async function bootstrapRepoAtCommit(input: {
  workspace: RuntimeWorkspace;
  root: string;
  repoUrl: string;
  commitSha: string;
  baseRefName?: string;
  timeoutMs?: number;
  userEmail?: string;
  userName?: string;
}): Promise<void> {
  const {
    workspace,
    root,
    repoUrl,
    commitSha,
    baseRefName = "base",
    timeoutMs = 180_000,
  } = input;
  const email = input.userEmail ?? "agent-runtime@pilab";
  const name = input.userName ?? "agent-runtime";
  const result = await workspace.run({
    command: [
      `mkdir -p ${shellQuote(root)}`,
      `git init -q ${shellQuote(root)}`,
      `git -C ${shellQuote(root)} remote add origin ${shellQuote(repoUrl)} 2>/dev/null || git -C ${shellQuote(root)} remote set-url origin ${shellQuote(repoUrl)}`,
      `git -C ${shellQuote(root)} fetch --depth=1 origin ${shellQuote(commitSha)}`,
      `git -C ${shellQuote(root)} checkout -B ${shellQuote(baseRefName)} ${shellQuote(commitSha)}`,
      `git -C ${shellQuote(root)} config user.email ${shellQuote(email)}`,
      `git -C ${shellQuote(root)} config user.name ${shellQuote(name)}`,
    ].join(" && "),
    timeoutMs,
  });
  if (result.exitCode !== 0) {
    throw new Error(`Failed to bootstrap repo at commit ${commitSha}: ${result.stderr || result.stdout}`);
  }
}

/** Add a worktree off `baseRef` (default `HEAD`) at `worktreePath`. */
export async function addWorktree(input: {
  workspace: RuntimeWorkspace;
  root: string;
  branch: string;
  worktreePath: string;
  baseRef?: string;
  timeoutMs?: number;
}): Promise<void> {
  const { workspace, root, branch, worktreePath, baseRef = "HEAD", timeoutMs = 30_000 } = input;
  const result = await workspace.run({
    command: `git -C ${shellQuote(root)} worktree add -q -b ${shellQuote(branch)} ${shellQuote(worktreePath)} ${shellQuote(baseRef)}`,
    timeoutMs,
  });
  if (result.exitCode !== 0) {
    throw new Error(`worktree add for ${branch} failed: ${result.stderr || result.stdout}`);
  }
}

/** Write `seedText` into `${worktreePath}/SEED.md` so the agent's first read picks it up. */
export async function writeSeedFile(input: {
  workspace: RuntimeWorkspace;
  worktreePath: string;
  seedText: string;
  fileName?: string;
}): Promise<void> {
  const { workspace, worktreePath, seedText, fileName = "SEED.md" } = input;
  if (!seedText.trim()) return;
  const encoded = Buffer.from(seedText, "utf8").toString("base64");
  const result = await workspace.run({
    command: `echo ${shellQuote(encoded)} | base64 -d > ${shellQuote(`${worktreePath}/${fileName}`)}`,
    timeoutMs: 15_000,
  });
  if (result.exitCode !== 0) {
    throw new Error(`Failed to write ${fileName} for ${worktreePath}: ${result.stderr || result.stdout}`);
  }
}

/** Read a JSON file from inside a worktree. Throws if missing or unparseable. */
export async function readJsonFromSandbox<T = unknown>(input: {
  workspace: RuntimeWorkspace;
  path: string;
}): Promise<T> {
  const raw = await input.workspace.readFile(input.path);
  return JSON.parse(raw) as T;
}
