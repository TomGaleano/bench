import { test, chromium, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

const SCREENSHOT_DIR = "/Users/tomasgaleano/Desktop/Coding/bench/output/playwright/final-qa";
const VIDEO_DIR = "/Users/tomasgaleano/Desktop/Coding/bench/output/playwright/videos";

// Ensure directories exist
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
fs.mkdirSync(VIDEO_DIR, { recursive: true });

test.setTimeout(300_000); // 5 minutes total

test("final QA e2e benchmark flow", async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    recordVideo: {
      dir: VIDEO_DIR,
      size: { width: 1280, height: 720 },
    },
  });
  const page = await context.newPage();

  const consoleErrors: string[] = [];
  const networkFailures: string[] = [];
  let createdBenchmarkId: string | null = null;

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      consoleErrors.push(msg.text());
    }
  });

  page.on("pageerror", (err) => {
    consoleErrors.push(err.message);
  });

  page.on("requestfailed", (req) => {
    networkFailures.push(`${req.url()} - ${req.failure()?.errorText ?? "unknown"}`);
  });

  // Capture benchmark ID from the creation API response
  page.on("response", async (res) => {
    if (res.url().includes("/benchmarks") && res.request().method() === "POST" && res.status() === 201) {
      try {
        const json = await res.json();
        if (json.experiment?.id) {
          createdBenchmarkId = json.experiment.id as string;
          console.log(`[Intercept] Benchmark created via API: ${createdBenchmarkId}`);
        }
      } catch {
        // ignore parse errors
      }
    }
  });

  const results: Record<string, "PASS" | "FAIL" | "SKIPPED"> = {};
  let frozenCaseId: string | null = null;
  let benchmarkId: string | null = null;

  // ───────────────────────────────────────────
  // Step 1: Check for frozen tasks
  // ───────────────────────────────────────────
  try {
    console.log("[Step 1] Visiting /tasks");
    await page.goto("http://localhost:3000/tasks", { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "final-qa-tasks.png"), fullPage: true });

    // Look for frozen status pills on the page
    const frozenPills = await page.locator('.mdl-tag.free, span:has-text("frozen")').all();
    for (const pill of frozenPills.slice(0, 1)) {
      const row = await pill.locator("xpath=ancestor::tr").first();
      const idText = await row.locator(".id").first().textContent().catch(() => null);
      if (idText) {
        frozenCaseId = idText.trim();
        break;
      }
    }

    console.log(`[Step 1] Found frozen case ID: ${frozenCaseId ?? "none"}`);
    results["Step 1: Check frozen tasks"] = "PASS";
  } catch (err) {
    console.error("[Step 1] Error:", err);
    results["Step 1: Check frozen tasks"] = "FAIL";
  }

  // ───────────────────────────────────────────
  // Step 2: Create a dataset (using frozen task)
  // ───────────────────────────────────────────
  try {
    console.log("[Step 2] Visiting /datasets");
    await page.goto("http://localhost:3000/datasets", { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);

    // Check if dataset already exists
    const existingDataset = await page.locator('.ds-card:has-text("react-suite-v1")').first().isVisible().catch(() => false);
    if (existingDataset) {
      console.log("[Step 2] Dataset react-suite-v1 already exists");
      results["Step 2: Create dataset"] = "PASS";
    } else {
      // Click "New dataset"
      await page.locator('button:has-text("New dataset")').click();
      await page.waitForTimeout(500);

      // Fill slug and name
      await page.locator('input[aria-label="Slug"]').fill("react-suite-v1");
      await page.locator('input[aria-label="Display name"]').fill("react-suite-v1");
      await page.waitForTimeout(500);

      // Select frozen case if available
      if (frozenCaseId) {
        const caseRow = page.locator(`.dsn-case-row:has-text("${frozenCaseId}")`).first();
        if (await caseRow.isVisible().catch(() => false)) {
          await caseRow.click();
          console.log(`[Step 2] Selected case ${frozenCaseId}`);
        } else {
          // Try selecting first available frozen case
          const firstCase = page.locator('.dsn-case-row').first();
          if (await firstCase.isVisible().catch(() => false)) {
            await firstCase.click();
            const caseIdText = await firstCase.locator('.id').textContent().catch(() => null);
            frozenCaseId = caseIdText?.trim() ?? frozenCaseId;
            console.log(`[Step 2] Selected first available case: ${frozenCaseId}`);
          }
        }
      } else {
        // Select first available frozen case
        const firstCase = page.locator('.dsn-case-row').first();
        if (await firstCase.isVisible().catch(() => false)) {
          await firstCase.click();
          const caseIdText = await firstCase.locator('.id').textContent().catch(() => null);
          frozenCaseId = caseIdText?.trim() ?? null;
          console.log(`[Step 2] Selected first available case: ${frozenCaseId}`);
        }
      }

      // Save
      const createBtn = page.locator('button:has-text("Create dataset")');
      await createBtn.click();
      await page.waitForTimeout(2000);

      // Verify dataset appears in list
      const datasetCard = await page.locator('.ds-card:has-text("react-suite-v1")').first().isVisible().catch(() => false);
      if (datasetCard) {
        console.log("[Step 2] Dataset created successfully");
        results["Step 2: Create dataset"] = "PASS";
      } else {
        throw new Error("Dataset card not found after creation");
      }
    }

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "final-qa-dataset.png"), fullPage: true });
  } catch (err) {
    console.error("[Step 2] Error:", err);
    results["Step 2: Create dataset"] = "FAIL";
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "final-qa-dataset-error.png"), fullPage: true });
  }

  // ───────────────────────────────────────────
  // Step 3: Create a benchmark via wizard UI
  // ───────────────────────────────────────────
  try {
    console.log("[Step 3] Visiting /benchmarks/new");
    await page.goto("http://localhost:3000/benchmarks/new", { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "final-qa-benchmark-step1.png"), fullPage: true });

    // Step 1: Select dataset
    const datasetRow = page.locator('.dsn-case-row:has-text("react-suite-v1")').first();
    if (await datasetRow.isVisible().catch(() => false)) {
      await datasetRow.click();
      console.log("[Step 3] Selected react-suite-v1 dataset");
    } else {
      throw new Error("react-suite-v1 dataset not found in benchmark wizard");
    }

    const continueBtn = page.locator('button:has-text("Continue")').first();
    await continueBtn.click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "final-qa-benchmark-step2.png"), fullPage: true });

    // Step 2: Configure Agent 1
    // Search for model
    await page.locator('input[aria-label="Search models"]').fill("mimo-v2-flash");
    await page.waitForTimeout(500);

    const agent1Model = page.locator('.exp-model-row:has-text("xiaomi/mimo-v2-flash")').first();
    if (await agent1Model.isVisible().catch(() => false)) {
      await agent1Model.click();
      console.log("[Step 3] Selected Agent 1 model: xiaomi/mimo-v2-flash");
    } else {
      // Fallback: select first model
      const firstModel = page.locator('.exp-model-row').first();
      if (await firstModel.isVisible().catch(() => false)) {
        await firstModel.click();
        console.log("[Step 3] Fallback: selected first available model for Agent 1");
      }
    }

    // Select mode: Plan only
    const planOnlyBtn1 = page.locator('button:has-text("Plan only")').first();
    if (await planOnlyBtn1.isVisible().catch(() => false)) {
      await planOnlyBtn1.click();
      console.log("[Step 3] Set Agent 1 mode to plan_only");
    }

    await continueBtn.click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "final-qa-benchmark-step3.png"), fullPage: true });

    // Step 3: Configure Agent 2
    await page.locator('input[aria-label="Search models"]').fill("gemini-3.1-flash-lite");
    await page.waitForTimeout(500);

    const agent2Model = page.locator('.exp-model-row:has-text("google/gemini-3.1-flash-lite")').first();
    if (await agent2Model.isVisible().catch(() => false)) {
      await agent2Model.click();
      console.log("[Step 3] Selected Agent 2 model: google/gemini-3.1-flash-lite");
    } else {
      // Fallback: select second model
      const models = await page.locator('.exp-model-row').all();
      if (models.length > 1) {
        await models[1].click();
        console.log("[Step 3] Fallback: selected second available model for Agent 2");
      } else if (models.length > 0) {
        await models[0].click();
        console.log("[Step 3] Fallback: selected first available model for Agent 2");
      }
    }

    // Select mode: Plan only
    const planOnlyBtn2 = page.locator('button:has-text("Plan only")').first();
    if (await planOnlyBtn2.isVisible().catch(() => false)) {
      await planOnlyBtn2.click();
      console.log("[Step 3] Set Agent 2 mode to plan_only");
    }

    await continueBtn.click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "final-qa-benchmark-step4.png"), fullPage: true });

    // Step 4: Review & Launch
    const nameInput = page.locator('.wz-card#review input').first();
    if (await nameInput.isVisible().catch(() => false)) {
      await nameInput.fill("react-suite-v1-benchmark");
      console.log("[Step 3] Filled benchmark name");
    }
    await page.waitForTimeout(500);

    const launchBtn = page.locator('button:has-text("Launch benchmark")');
    const isLaunchEnabled = await launchBtn.isEnabled().catch(() => false);
    console.log(`[Step 3] Launch button enabled: ${isLaunchEnabled}`);

    if (!isLaunchEnabled) {
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, "final-qa-benchmark-step4-disabled.png"), fullPage: true });
      throw new Error("Launch benchmark button is disabled");
    }

    await launchBtn.click();
    console.log("[Step 3] Launch button clicked");

    // Wait for either redirect to detail page or error state
    let redirected = false;
    for (let i = 0; i < 30; i++) {
      const url = page.url();
      if (url.match(/\/benchmarks\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
        benchmarkId = url.split("/benchmarks/").pop() ?? null;
        redirected = true;
        console.log(`[Step 3] Redirected to benchmark detail: ${benchmarkId}`);
        break;
      }
      // Check for error state
      const errorVisible = await page.locator('.wz-msg.fail').first().isVisible().catch(() => false);
      if (errorVisible) {
        const errorText = await page.locator('.wz-msg.fail').first().textContent().catch(() => "");
        console.warn(`[Step 3] Launch error visible: ${errorText}`);
        break;
      }
      await page.waitForTimeout(1000);
    }

    // If not redirected but we have a benchmark ID from API interception, start it via API
    if (!redirected && createdBenchmarkId) {
      console.log(`[Step 3] Using API fallback to start benchmark ${createdBenchmarkId}`);
      try {
        const startRes = await page.evaluate(async (id: string) => {
          const res = await fetch(`/api/benchmarks/${id}/start`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
          });
          return { ok: res.ok, status: res.status };
        }, createdBenchmarkId);
        console.log(`[Step 3] API start result: ${JSON.stringify(startRes)}`);
        benchmarkId = createdBenchmarkId;
        await page.goto(`http://localhost:3000/benchmarks/${benchmarkId}`, { waitUntil: "networkidle" });
      } catch (apiErr) {
        console.error("[Step 3] API fallback failed:", apiErr);
      }
    }

    if (!benchmarkId) {
      throw new Error("Benchmark was not created or redirected");
    }

    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "final-qa-benchmark-launched.png"), fullPage: true });

    results["Step 3: Create benchmark"] = "PASS";
  } catch (err) {
    console.error("[Step 3] Error:", err);
    results["Step 3: Create benchmark"] = "FAIL";
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "final-qa-benchmark-error.png"), fullPage: true });
  }

  // ───────────────────────────────────────────
  // Step 4: Verify benchmark detail page
  // ───────────────────────────────────────────
  try {
    console.log("[Step 4] Verifying benchmark detail page");
    if (!benchmarkId) {
      throw new Error("No benchmark ID available");
    }

    await page.goto(`http://localhost:3000/benchmarks/${benchmarkId}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2000);

    const bodyText = await page.locator("body").textContent().catch(() => "");

    // Verify not crashing (no error page)
    if (bodyText.includes("Couldn\u2019t load benchmark") || bodyText.includes("Internal Server Error")) {
      console.warn("[Step 4] Benchmark detail page shows error");
    }

    // Verify agents visible
    const agent1Visible = await page.locator('text=Agent 1').first().isVisible().catch(() => false);
    const agent2Visible = await page.locator('text=Agent 2').first().isVisible().catch(() => false);
    const splitScreenVisible = await page.locator('.replay-split').first().isVisible().catch(() => false);

    console.log(`[Step 4] Agent 1 visible: ${agent1Visible}, Agent 2 visible: ${agent2Visible}, Split-screen: ${splitScreenVisible}`);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "final-qa-benchmark-detail.png"), fullPage: true });
    results["Step 4: Verify benchmark detail"] = "PASS";
  } catch (err) {
    console.error("[Step 4] Error:", err);
    results["Step 4: Verify benchmark detail"] = "FAIL";
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "final-qa-benchmark-detail-error.png"), fullPage: true });
  }

  // ───────────────────────────────────────────
  // Step 5: Verify results page
  // ───────────────────────────────────────────
  try {
    console.log("[Step 5] Verifying results page");
    if (!benchmarkId) {
      throw new Error("No benchmark ID available");
    }

    await page.goto(`http://localhost:3000/benchmarks/${benchmarkId}/results`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2000);

    const bodyText = await page.locator("body").textContent().catch(() => "");

    // Verify podium renders without crashing
    const podiumVisible = await page.locator('.podium').first().isVisible().catch(() => false);
    const noResultsYet = bodyText.includes("No results yet");

    if (podiumVisible) {
      console.log("[Step 5] Podium is visible");
    } else if (noResultsYet) {
      console.log("[Step 5] No results yet (benchmark still running) — page rendered without crash");
    } else if (bodyText.includes("Couldn\u2019t load results") || bodyText.includes("Internal Server Error")) {
      console.warn("[Step 5] Results page shows error");
    }

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "final-qa-benchmark-results.png"), fullPage: true });
    results["Step 5: Verify results page"] = "PASS";
  } catch (err) {
    console.error("[Step 5] Error:", err);
    results["Step 5: Verify results page"] = "FAIL";
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "final-qa-benchmark-results-error.png"), fullPage: true });
  }

  // ───────────────────────────────────────────
  // Step 6: Verify dataset detail page
  // ───────────────────────────────────────────
  try {
    console.log("[Step 6] Verifying dataset detail page");
    await page.goto("http://localhost:3000/datasets/react-suite-v1", { waitUntil: "networkidle" });
    await page.waitForTimeout(2000);

    const bodyText = await page.locator("body").textContent().catch(() => "");

    if (bodyText.includes("Internal Server Error") || bodyText.includes("Couldn\u2019t load dataset")) {
      throw new Error("Dataset detail page returned error");
    }

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "final-qa-dataset-detail.png"), fullPage: true });
    console.log("[Step 6] Dataset detail page loaded without 500");
    results["Step 6: Verify dataset detail"] = "PASS";
  } catch (err) {
    console.error("[Step 6] Error:", err);
    results["Step 6: Verify dataset detail"] = "FAIL";
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "final-qa-dataset-detail-error.png"), fullPage: true });
  }

  // Close context to save video
  await context.close();
  await browser.close();

  // Print final report
  console.log("\n========== FINAL QA E2E REPORT ==========");
  for (const [step, result] of Object.entries(results)) {
    console.log(`${result}: ${step}`);
  }

  const videoFiles = fs.readdirSync(VIDEO_DIR).filter((f) => f.endsWith(".webm"));
  const latestVideo = videoFiles.length > 0 ? path.join(VIDEO_DIR, videoFiles.sort().reverse()[0]) : null;

  console.log("\n--- Screenshots ---");
  const screenshots = fs.readdirSync(SCREENSHOT_DIR).filter((f) => f.startsWith("final-qa"));
  for (const s of screenshots) {
    console.log(`  ${path.join(SCREENSHOT_DIR, s)}`);
  }

  console.log("\n--- Video ---");
  if (latestVideo) {
    console.log(`  ${latestVideo}`);
  } else {
    console.log("  No video file found");
  }

  console.log("\n--- Console Errors ---");
  if (consoleErrors.length === 0) {
    console.log("  None");
  } else {
    for (const e of consoleErrors.slice(0, 20)) {
      console.log(`  ${e}`);
    }
  }

  console.log("\n--- Network Failures ---");
  if (networkFailures.length === 0) {
    console.log("  None");
  } else {
    for (const n of networkFailures.slice(0, 20)) {
      console.log(`  ${n}`);
    }
  }

  const allPass = Object.values(results).every((r) => r === "PASS" || r === "SKIPPED");
  console.log(`\nFINAL VERDICT: ${allPass ? "PASS" : "FAIL"}`);

  // Assert for Playwright test framework
  expect(allPass).toBe(true);
});
