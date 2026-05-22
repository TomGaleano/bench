import { test, expect, chromium } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

const OUTPUT_DIR = "/tmp/pilab-qa-output";

// Ensure output directory exists
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

test.setTimeout(120_000);

test("smoke test: app starts and OpenRouter + Daytona connections work", async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  const results: Record<string, "PASS" | "FAIL"> = {};
  const errors: string[] = [];
  const networkFailures: string[] = [];

  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(err.message));
  page.on("requestfailed", (req) => {
    networkFailures.push(`${req.url()} - ${req.failure()?.errorText ?? "unknown"}`);
  });

  // ───────────────────────────────────────────
  // Step 1: Web app loads
  // ───────────────────────────────────────────
  try {
    console.log("[Step 1] Loading web app at http://localhost:3002");
    await page.goto("http://localhost:3002", { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    const title = await page.title();
    expect(title).toContain("Pi Lab");
    await page.screenshot({ path: path.join(OUTPUT_DIR, "01-home.png"), fullPage: true });
    results["Web app loads"] = "PASS";
    console.log("[Step 1] PASS - Pi Lab loaded");
  } catch (err) {
    console.error("[Step 1] FAIL:", err);
    results["Web app loads"] = "FAIL";
    await page.screenshot({ path: path.join(OUTPUT_DIR, "01-home-error.png"), fullPage: true });
  }

  // ───────────────────────────────────────────
  // Step 2: API health check via proxy
  // ───────────────────────────────────────────
  try {
    console.log("[Step 2] Checking API health via /api/health proxy");
    const health = await page.evaluate(async () => {
      const res = await fetch("/api/health");
      return res.json();
    });
    expect(health.status).toBe("ok");
    expect(health.service).toBe("api");
    results["API health via proxy"] = "PASS";
    console.log("[Step 2] PASS - API health:", health);
  } catch (err) {
    console.error("[Step 2] FAIL:", err);
    results["API health via proxy"] = "FAIL";
  }

  // ───────────────────────────────────────────
  // Step 3: Settings page shows Daytona configured
  // ───────────────────────────────────────────
  try {
    console.log("[Step 3] Checking Settings page for Daytona status");
    await page.goto("http://localhost:3002/settings", { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);
    const bodyText = await page.locator("body").textContent();
    expect(bodyText).toContain("Daytona");
    expect(bodyText).toContain("configured");
    await page.screenshot({ path: path.join(OUTPUT_DIR, "03-settings.png"), fullPage: true });
    results["Daytona configured in UI"] = "PASS";
    console.log("[Step 3] PASS - Daytona shows configured");
  } catch (err) {
    console.error("[Step 3] FAIL:", err);
    results["Daytona configured in UI"] = "FAIL";
    await page.screenshot({ path: path.join(OUTPUT_DIR, "03-settings-error.png"), fullPage: true });
  }

  // ───────────────────────────────────────────
  // Step 4: OpenRouter connection works (/api/models)
  // ───────────────────────────────────────────
  try {
    console.log("[Step 4] Verifying OpenRouter connection via /api/models");
    const modelsData = await page.evaluate(async () => {
      const res = await fetch("/api/models");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    });
    expect(modelsData.count).toBeGreaterThan(0);
    expect(Array.isArray(modelsData.models)).toBe(true);
    results["OpenRouter connection (/api/models)"] = "PASS";
    console.log(`[Step 4] PASS - OpenRouter returned ${modelsData.count} models`);
  } catch (err) {
    console.error("[Step 4] FAIL:", err);
    results["OpenRouter connection (/api/models)"] = "FAIL";
  }

  // ───────────────────────────────────────────
  // Step 5: Daytona API is reachable directly
  // ───────────────────────────────────────────
  try {
    console.log("[Step 5] Verifying Daytona API directly at localhost:3000/api/health");
    const daytonaHealth = await page.evaluate(async () => {
      const res = await fetch("http://localhost:3000/api/health");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    });
    expect(daytonaHealth.status).toBe("ok");
    results["Daytona API reachable"] = "PASS";
    console.log("[Step 5] PASS - Daytona API health:", daytonaHealth);
  } catch (err) {
    console.error("[Step 5] FAIL:", err);
    results["Daytona API reachable"] = "FAIL";
  }

  await context.close();
  await browser.close();

  // Print report
  console.log("\n========== CONNECTION SMOKE TEST REPORT ==========");
  for (const [step, result] of Object.entries(results)) {
    console.log(`${result}: ${step}`);
  }
  console.log("\n--- Console Errors ---");
  if (errors.length === 0) console.log("  None");
  else errors.slice(0, 10).forEach((e) => console.log(`  ${e}`));
  console.log("\n--- Network Failures ---");
  if (networkFailures.length === 0) console.log("  None");
  else networkFailures.slice(0, 10).forEach((n) => console.log(`  ${n}`));

  const allPass = Object.values(results).every((r) => r === "PASS");
  console.log(`\nFINAL VERDICT: ${allPass ? "PASS" : "FAIL"}`);
  expect(allPass).toBe(true);
});
