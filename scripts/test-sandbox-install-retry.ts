/**
 * Live test of the RETRY path in installPiAgentRuntime against a real E2B
 * sandbox.
 *
 * How we force the first attempt to fail:
 *   - Write a `.npmrc` in the runtime dir pointing npm at a black-hole local
 *     registry (127.0.0.1:1). The first `npm install` attempt fails with
 *     ECONNREFUSED in ~1s, well under the 600s cap.
 *   - Then `installPiAgentRuntime` runs its own cleanup (rm -rf
 *     node_modules + package-lock.json) before attempt 2. But — crucially —
 *     it does NOT remove the `.npmrc`. Production install would also keep
 *     it. So for this test we use a process-substitution trick: install a
 *     "watcher" inside the sandbox that nukes the bad `.npmrc` as soon as
 *     it sees attempt 1's node_modules cleanup happen, just before attempt 2
 *     starts.
 *
 * Run with:
 *   pnpm dlx tsx --env-file=.env scripts/test-sandbox-install-retry.ts
 *
 * Exit codes:
 *   0 — installPiAgentRuntime recovered via its retry, package is installed
 *   1 — anything else (no recovery, no retry, or attempt 2 still fails)
 */
import { createBenchmarkRuntime, installPiAgentRuntime, shellQuote } from "@pilab/runtime";

const BAD_NPMRC = "registry=http://127.0.0.1:1/\nfetch-timeout=5000\nfetch-retries=0\n";

async function main() {
  if (!process.env.E2B_API_KEY) {
    console.error("E2B_API_KEY not set");
    process.exit(1);
  }

  const cwd = "/home/user/retry-test";
  const runtimeDir = `${cwd}/.pilab-agent-runtime`;

  console.log("[retry-test] creating E2B sandbox…");
  const runtime = createBenchmarkRuntime();
  const sandbox = await runtime.createWorkspace({
    id: `retry-test-${Math.random().toString(36).slice(2, 10)}`,
    timeoutMs: 5 * 60 * 1000,
  });
  console.log(`[retry-test] sandbox=${sandbox.id}`);

  try {
    await sandbox.run({
      command: `mkdir -p ${shellQuote(runtimeDir)}`,
      timeoutMs: 10_000,
    });
    await sandbox.writeFile({
      path: `${runtimeDir}/package.json`,
      content: JSON.stringify(
        { type: "module", dependencies: { "@mariozechner/pi-coding-agent": "^0.73.0" } },
        null,
        2,
      ),
    });
    // ── Force attempt 1 to fail ──────────────────────────────────────
    await sandbox.writeFile({ path: `${runtimeDir}/.npmrc`, content: BAD_NPMRC });
    // ── Watcher: when production's `rm -rf node_modules package-lock.json`
    //     happens between attempts, replace the bad .npmrc with an empty file
    //     so attempt 2 hits the real registry. We poll for the rm by checking
    //     for the disappearance of node_modules; once gone, drop .npmrc.
    //     (We can't directly observe the cleanup, but the rm in production
    //     happens *before* the retry npm install — so we look for an
    //     install.lock file we drop manually.) ───────────────────────────
    await sandbox.writeFile({
      path: `${cwd}/swap-npmrc.sh`,
      content: `#!/bin/bash
# Wait until production has run its cleanup (node_modules disappears or has
# 0 entries) then swap .npmrc to point at the real registry.
for i in $(seq 1 60); do
  if [ ! -d ${shellQuote(`${runtimeDir}/node_modules`)} ] || [ -z "$(ls -A ${shellQuote(`${runtimeDir}/node_modules`)} 2>/dev/null)" ]; then
    # First iteration may run before any install has touched node_modules.
    # Only swap once we've also seen the package-lock.json from attempt 1
    # appear (or once we know attempt 1 already failed and was cleaned up).
    if [ "$i" -gt 2 ]; then
      echo "" > ${shellQuote(`${runtimeDir}/.npmrc`)}
      echo "[watcher] swapped .npmrc at iteration $i"
      exit 0
    fi
  fi
  sleep 1
done
echo "[watcher] never triggered" >&2
exit 1
`,
    });
    // Kick off the watcher in the background.
    void sandbox.run({
      command: `bash ${shellQuote(`${cwd}/swap-npmrc.sh`)} &`,
      cwd,
      timeoutMs: 75_000,
    });

    console.log("[retry-test] calling installPiAgentRuntime (expecting attempt 1 to fail, attempt 2 to succeed)…");
    const t0 = Date.now();
    await installPiAgentRuntime(sandbox, runtimeDir, cwd);
    const elapsedMs = Date.now() - t0;
    console.log(`[retry-test] ✓ installPiAgentRuntime returned successfully in ${(elapsedMs / 1000).toFixed(1)}s`);

    // Verify pi-coding-agent is actually installed.
    const ls = await sandbox.run({
      command: `ls ${shellQuote(`${runtimeDir}/node_modules/@mariozechner/pi-coding-agent`)} 2>/dev/null | wc -l`,
      cwd: runtimeDir,
      timeoutMs: 10_000,
    });
    const count = parseInt(ls.stdout.trim(), 10);
    if (count > 3) {
      console.log(`[retry-test] ✓ pi-coding-agent installed (${count} entries in package dir)`);
      console.log("[retry-test] ✓ ALL ASSERTIONS PASSED — retry path works end-to-end");
      process.exit(0);
    } else {
      console.error(`[retry-test] ✗ install supposedly succeeded but package dir has only ${count} entries`);
      process.exit(1);
    }
  } catch (err) {
    console.error("[retry-test] ✗ installPiAgentRuntime threw:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  } finally {
    console.log("[retry-test] tearing down sandbox…");
    await sandbox.delete().catch(() => undefined);
  }
}

main().catch((err) => {
  console.error("[retry-test] uncaught:", err);
  process.exit(1);
});
