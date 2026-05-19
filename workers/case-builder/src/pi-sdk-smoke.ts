/**
 * Quick verification that Pi SDK imports and model resolution work.
 *
 * Run with:
 *   OPENROUTER_API_KEY=... tsx src/pi-sdk-smoke.ts
 */

async function main() {
  const pi = await import("@mariozechner/pi-coding-agent");
  const apiKey = process.env.OPENROUTER_API_KEY ?? "";
  const modelId = process.env.TEST_BUILDER_MODEL_ID ?? "moonshotai/kimi-k2.6";
  const provider = "openrouter";

  console.log("Pi SDK imported successfully");

  const authStorage = pi.AuthStorage.create("/tmp/pi-smoke-auth.json");
  authStorage.setRuntimeApiKey(provider, apiKey);

  const modelRegistry = pi.ModelRegistry.create(authStorage);
  const modelName = modelId.includes("/")
    ? modelId.slice(modelId.indexOf("/") + 1)
    : modelId;

  console.log(`Looking up model: ${provider}/${modelName}`);
  const model = modelRegistry.find(provider, modelName);

  if (!model) {
    console.error(`Model not found: ${provider}/${modelName}`);
    // Try common variations
    const variations = [
      modelName,
      modelName.toLowerCase(),
      modelName.replace(/-/g, ""),
      `moonshotai/${modelName}`,
    ];
    for (const v of variations) {
      const m = modelRegistry.find(provider, v);
      console.error(`  ${v}: ${m ? "FOUND" : "NOT FOUND"}`);
    }
    process.exit(1);
  }

  console.log(`Found model: ${model.id} (${model.provider})`);
  console.log("Pi SDK smoke test passed");
}

main().catch((error) => {
  console.error("Smoke test failed:", error);
  process.exit(1);
});
