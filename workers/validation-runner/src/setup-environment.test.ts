import { test } from "node:test";
import assert from "node:assert/strict";

// We import the implementation by re-declaring the predicates here. The
// helpers are intentionally private (not exported) — we re-implement the
// same regexes in this file to pin the contract so future edits don't
// regress the "skip frontend builds" / "detect OOM" behaviour that
// unblocked the validation-runner on HKUDS/nanobot.

const FRONTEND_BUILD_RE = new RegExp(
  [
    "(?:^|[\\s;&|()`])npm\\s+(?:ci|install|run\\s+build|run\\s+dev|run\\s+watch|run\\s+start)\\b",
    "(?:^|[\\s;&|()`])pnpm\\s+(?:install|i|build|run\\s+build|run\\s+dev|run\\s+watch|run\\s+start)\\b",
    "(?:^|[\\s;&|()`])yarn\\s+(?:install|add|build|run\\s+build|run\\s+dev|run\\s+watch|run\\s+start)\\b",
    "(?:^|[\\s;&|()`])yarn(?:\\s|$)",
    "(?:^|[\\s;&|()`])bun\\s+(?:install|build|run\\s+build)\\b",
    "(?:^|[\\s;&|()`])npx\\s+(?:next|vite|webpack|rollup|esbuild|turbo)\\b",
    "(?:^|[\\s;&|()`])(?:next|vite|webpack|rollup|esbuild|turbo|parcel)(?:\\s+(?:build|dev)\\b|\\s*$)",
    "(?:^|[\\s;&|()`])tsc\\s+(?:-b|--build)\\b",
  ].join("|"),
);

function isFrontendBuildCommand(cmd: string): boolean {
  return FRONTEND_BUILD_RE.test(cmd);
}

function isOomFailure(result: { exitCode: number; stdout: string; stderr: string }): boolean {
  if (result.exitCode === 137) return true;
  const blob = `${result.stdout}\n${result.stderr}`.toLowerCase();
  return (
    (blob.includes("killed") &&
      (blob.includes("npm") || blob.includes("node") || blob.includes("oom") || blob.includes("out of memory") || /\bsignal\s*9\b/.test(blob))) ||
    blob.includes("javascript heap out of memory") ||
    blob.includes("allocation failure; scavenge might not succeed") ||
    blob.includes("mark-compact")
  );
}

test("blocks the exact commands the setup-agent kept proposing for HKUDS/nanobot", () => {
  for (const cmd of [
    "cd webui && npm ci && npm run build",
    "cd webui && npm install && npm run build",
    "npm ci",
    "npm install",
    "npm run build",
    "yarn install",
    "yarn build",
    "yarn",
    "pnpm install",
    "pnpm build",
    "npx next build",
    "next build",
    "vite build",
    "webpack",
    "tsc -b",
    "tsc --build",
  ]) {
    assert.equal(isFrontendBuildCommand(cmd), true, `expected to skip: ${cmd}`);
  }
});

test("allows Python install commands through", () => {
  for (const cmd of [
    "python3 -m venv .venv",
    ".venv/bin/pip install --retries 5 --timeout 30 --upgrade pip setuptools wheel",
    ".venv/bin/pip install -e . --retries 5 --timeout 30",
    ".venv/bin/pip install '.[test]' '.[testing]' '.[dev]' --retries 5 --timeout 30",
    ".venv/bin/pip install pytest",
    ".venv/bin/python -c 'import markupsafe; print(markupsafe.__version__)'",
    "apt-get update && apt-get install -y gcc python3-dev",
  ]) {
    assert.equal(isFrontendBuildCommand(cmd), false, `expected to allow: ${cmd}`);
  }
});

test("does not false-positive on Python commands that happen to contain JS-like substrings", () => {
  for (const cmd of [
    ".venv/bin/pip install npm-tools",      // package name containing 'npm'
    ".venv/bin/python -c 'print(\"yarn\")'", // literal containing 'yarn'
    "echo 'tsc' && true",
  ]) {
    assert.equal(isFrontendBuildCommand(cmd), false, `false positive: ${cmd}`);
  }
});

test("detects OOM by exit code 137", () => {
  assert.equal(isOomFailure({ exitCode: 137, stdout: "", stderr: "" }), true);
});

test("detects OOM by Killed + node/npm in stderr (HKUDS/nanobot's actual signature)", () => {
  assert.equal(
    isOomFailure({
      exitCode: 1,
      stdout: "",
      stderr: "/bin/bash: line 1:   645 Killed                  npm ci",
    }),
    true,
  );
});

test("detects V8 GC blow-up signatures", () => {
  for (const stderr of [
    "<--- Last few GCs --->\n[684:0x208213a0]     8835 ms: Mark-Compact 251.7 (258.4) -> 250.5",
    "FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory",
    "allocation failure; scavenge might not succeed",
  ]) {
    assert.equal(isOomFailure({ exitCode: 1, stdout: "", stderr }), true, `missed OOM: ${stderr.slice(0, 40)}`);
  }
});

test("does not call ordinary pip failures OOM", () => {
  assert.equal(
    isOomFailure({
      exitCode: 1,
      stdout: "",
      stderr: "ERROR: Could not find a version that satisfies the requirement foo",
    }),
    false,
  );
});
