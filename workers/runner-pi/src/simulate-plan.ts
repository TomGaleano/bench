import { join } from "path";
import { mkdir, writeFile } from "fs/promises";

async function main() {
  const workspacePath = "/tmp/simulation-workspace/repo";
  const agentDir = "/tmp/simulation-workspace/agent";
  const outputDir = "/tmp/simulation-workspace/output";
  await mkdir(agentDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });

  const pi = await import("@mariozechner/pi-coding-agent");
  const provider = "openrouter";
  const modelName = "minimax-m2.7";
  const authStorage = pi.AuthStorage.create(join(agentDir, "auth.json"));
  const runtimeKey = process.env.OPENROUTER_API_KEY;
  if (runtimeKey) {
    authStorage.setRuntimeApiKey(provider, runtimeKey);
  }

  const modelRegistry = pi.ModelRegistry.create(authStorage);
  const model = modelRegistry.find(provider, modelName);
  if (!model) {
    console.error("Model not found:", modelName);
    process.exit(1);
  }
  console.log("Model resolved:", JSON.stringify({ id: model.id, name: model.name, contextWindow: model.contextWindow }));

  const settingsManager = pi.SettingsManager.inMemory({
    compaction: { enabled: false },
    retry: { enabled: true, maxRetries: 1 },
  });

  const issueTitle = "doctor --fix removes allow-only externalized plugins (lobster) during v2026.5.2 one-time migration";
  const issueBody = `## Summary

When upgrading from v2026.4.27 to v2026.5.2, \`openclaw doctor --fix\` triggers a one-time plugin externalization migration that silently removes \`lobster\` (and potentially other allow-only externalized plugins) from both \`plugins.allow\` and \`plugins.entries\` in \`openclaw.json\`. This breaks all cron jobs that depend on lobster pipelines (briefings, digests, etc.) with no warning or error message.

## Steps to Reproduce

1. Running v2026.4.27 with lobster configured:
   - \`plugins.allow: ["bluebubbles", "lobster", ...]\`
   - \`plugins.entries.lobster: { "enabled": true, "config": {} }\`
   - Multiple cron jobs running lobster pipelines (ClawFlow briefings/digests)
2. Upgrade to v2026.5.2: \`npm install -g openclaw\`
3. Run \`openclaw doctor --fix\`
4. Check config: lobster is gone from both \`plugins.allow\` and \`plugins.entries\`

## Expected Behavior

Doctor should detect that lobster is in \`plugins.allow\`, recognize it as an official external plugin (it's in the catalog as \`@openclaw/lobster\`), install it via npm, and preserve the allow/entries configuration.

## Actual Behavior

- Doctor's one-time release step (\`collectReleaseConfiguredPluginIds\`) does NOT read \`plugins.allow\` to determine which plugins to install
- It only collects from: channels, providers, model refs, slots, agent harness runtimes, web search/fetch providers
- Lobster is a pure workflow runtime plugin — none of those categories
- The stale-entry cleanup then runs, sees lobster has no install record, and calls \`removePluginFromConfig\` which wipes it from allow + entries
- All lobster-dependent cron jobs silently fail on next fire

## Impact

In our case this silently broke 6 cron jobs (4 briefing/digest pipelines + 2 health checks) that all use \`.lobster\` pipeline files. No error was surfaced — cron just produced nothing. We only caught it because we verified immediately after upgrade.

## Root Cause (confirmed in source)

- \`release-configured-plugin-installs-CvfnGeYf.js\` lines 151-173: \`collectReleaseConfiguredPluginIds\` calls multiple \`collect*\` helpers but never reads \`config.plugins.allow\`
- \`missing-configured-plugin-install-A5tUUqKF.js\` lines 46-67: The non-release repair function (\`collectConfiguredPluginIds\`) DOES read \`plugins.allow\`, but the release step bypasses it — it calls \`repairMissingPluginInstallsForIds\` with its own narrower collection instead of \`repairMissingConfiguredPluginInstalls\`
- \`uninstall-TRIhnPr4.js\` lines 181-270: \`removePluginFromConfig\` wipes allow, entries, installs, and load.paths

## Suggested Fix

In \`collectReleaseConfiguredPluginIds\`, add \`plugins.allow\` entries to the collection set. Specifically: for each ID in \`config.plugins.allow\`, if it appears in \`listOfficialExternalPluginCatalogEntries()\` (i.e., it was a bundled plugin that's now external), include it in the set passed to \`repairMissingPluginInstallsForIds\`.

Alternatively, the release step could call \`repairMissingConfiguredPluginInstalls\` (which already reads allow) instead of constructing its own narrower set.`;

  const prompt = [
    "You are running a Pi Lab plan-only benchmark.",
    "Case version: 6b032e36-6069-4ef2-9715-91516eb9f764.",
    "",
    "## GitHub Issue: " + issueTitle,
    "",
    issueBody,
    "",
    "Inspect the repository context with read-only tools and produce a concise implementation plan.",
    "Do not create, edit, delete, move, stage, commit, or patch files.",
  ].join("\n");

  console.log("\n=== FULL PROMPT ===");
  console.log(prompt);
  console.log("=== END PROMPT ===\n");

  const resourceLoader = new pi.DefaultResourceLoader({
    cwd: workspacePath,
    agentDir,
    settingsManager,
    systemPromptOverride: () =>
      "You are running in Pi Lab plan-only benchmark mode. Produce a concrete implementation plan. Do not modify files.",
  });
  await resourceLoader.reload();

  const { session } = await pi.createAgentSession({
    cwd: workspacePath,
    agentDir,
    model,
    thinkingLevel: "off",
    authStorage,
    modelRegistry,
    tools: ["read", "grep", "find", "ls"],
    resourceLoader,
    sessionManager: pi.SessionManager.inMemory(workspacePath),
    settingsManager,
  });

  const events: unknown[] = [];
  let lastEventTime = Date.now();
  
  session.subscribe((sdkEvent: unknown) => {
    events.push(sdkEvent);
    lastEventTime = Date.now();
    const ev = sdkEvent as Record<string, unknown>;
    const type = ev.type ?? "unknown";
    if (events.length <= 20 || events.length % 50 === 0) {
      console.log(`[event #${events.length}] type=${type}`);
    }
  });

  // Heartbeat
  const heartbeat = setInterval(() => {
    const elapsed = (Date.now() - lastEventTime) / 1000;
    if (elapsed > 30) {
      console.log(`[HEARTBEAT] No events for ${elapsed.toFixed(0)}s`);
    }
  }, 5000);

  console.log("Starting prompt...");
  const startTime = Date.now();
  
  try {
    await session.prompt(prompt);
    const duration = (Date.now() - startTime) / 1000;
    console.log(`\nPrompt completed in ${duration.toFixed(1)}s, total events: ${events.length}`);
  } catch (error) {
    const duration = (Date.now() - startTime) / 1000;
    console.log(`\nPrompt failed after ${duration.toFixed(1)}s: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    clearInterval(heartbeat);
    session.abort?.();
  }

  // Write full event log
  const eventLogPath = join(outputDir, "events.json");
  await writeFile(eventLogPath, JSON.stringify(events, null, 2));
  console.log(`Events written to ${eventLogPath}`);

  // Extract plan text from events
  const planChunks: string[] = [];
  for (const ev of events) {
    const e = ev as Record<string, unknown>;
    if (e.type === "message_update" && (e.assistantMessageEvent as Record<string, unknown>)?.type === "text_delta") {
      planChunks.push(String((e.assistantMessageEvent as Record<string, unknown>).delta ?? ""));
    }
  }
  const planText = planChunks.join("");
  console.log("\n=== EXTRACTED PLAN ===");
  console.log(planText || "(no plan text extracted)");
  console.log("=== END PLAN ===");

  await writeFile(join(outputDir, "plan.md"), planText || "# No plan generated\n");
  console.log(`Plan written to ${join(outputDir, "plan.md")}`);
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
