/**
 * Live test of `installPiAgentRuntime` against a real E2B sandbox.
 *
 * Mirrors what every shared-sandbox call site does:
 *   - playground-runner spawning N agents
 *   - benchmark-batch-processor spawning N benchmarked agents + the evaluator
 *   - case-builder spawning the test-builder agent
 *
 * Run with:
 *   pnpm dlx tsx --env-file=.env scripts/test-sandbox-install.ts
 *
 * Required env: E2B_API_KEY
 *
 * Exit codes:
 *   0 — install completed within the cap on the first or second attempt
 *   1 — install failed terminally
 */
import { createBenchmarkRuntime, installPiAgentRuntime, shellQuote } from "@pilab/runtime";

async function main() {
  if (!process.env.E2B_API_KEY) {
    console.error("E2B_API_KEY not set. Run with --env-file=.env");
    process.exit(1);
  }

  const cwd = "/home/user/install-test";
  const runtimeDir = `${cwd}/.pilab-agent-runtime`;

  console.log("[install-test] creating E2B sandbox…");
  const runtime = createBenchmarkRuntime();
  const sandbox = await runtime.createWorkspace({
    id: `install-test-${Math.random().toString(36).slice(2, 10)}`,
    // Total cap: install (up to 10 min × 2 attempts) + slack.
    timeoutMs: (20 * 60 + 60) * 1000,
  });
  console.log(`[install-test] sandbox=${sandbox.id}`);

  const t0 = Date.now();
  try {
    // Replicate the exact pre-install steps from runSandboxPiAgent.
    await sandbox.run({
      command: `mkdir -p ${shellQuote(cwd)} ${shellQuote(runtimeDir)}`,
      timeoutMs: 10_000,
    });
    await sandbox.writeFile({
      path: `${runtimeDir}/package.json`,
      content: JSON.stringify(
        {
          type: "module",
          dependencies: { "@mariozechner/pi-coding-agent": "^0.73.0" },
        },
        null,
        2,
      ),
    });

    console.log("[install-test] calling installPiAgentRuntime…");
    const installStart = Date.now();
    await installPiAgentRuntime(sandbox, runtimeDir, cwd);
    const installMs = Date.now() - installStart;
    console.log(`[install-test] ✓ install completed in ${(installMs / 1000).toFixed(1)}s`);

    // Confirm the package is actually usable: list installed version + verify
    // a couple of expected entrypoints exist.
    const verify = await sandbox.run({
      command: `cd ${shellQuote(runtimeDir)} && npm ls @mariozechner/pi-coding-agent --depth=0 --json 2>/dev/null | head -200`,
      cwd: runtimeDir,
      timeoutMs: 30_000,
    });
    const entrypoints = await sandbox.run({
      command: `ls ${shellQuote(`${runtimeDir}/node_modules/@mariozechner/pi-coding-agent`)} 2>/dev/null | head -20`,
      cwd: runtimeDir,
      timeoutMs: 10_000,
    });
    console.log("[install-test] npm ls (truncated):");
    console.log(verify.stdout.split("\n").slice(0, 10).join("\n"));
    console.log("[install-test] entrypoints:");
    console.log(entrypoints.stdout.trim() || "(none)");

    const totalMs = Date.now() - t0;
    console.log(`[install-test] ✓ TOTAL ${(totalMs / 1000).toFixed(1)}s (sandbox boot + install + verify)`);
    process.exit(0);
  } catch (err) {
    const elapsedMs = Date.now() - t0;
    console.error(`[install-test] ✗ FAILED after ${(elapsedMs / 1000).toFixed(1)}s`);
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  } finally {
    console.log("[install-test] tearing down sandbox…");
    await sandbox.delete().catch(() => undefined);
  }
}

main().catch((err) => {
  console.error("[install-test] uncaught:", err);
  process.exit(1);
});
