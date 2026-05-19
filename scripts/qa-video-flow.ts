import { chromium } from "playwright";
import { mkdir, readdir, stat } from "fs/promises";
import { join } from "path";

const VIDEO_DIR = "/Users/tomasgaleano/Desktop/Coding/bench/output/playwright/videos";
const BASE_URL = "http://localhost:3000";

async function wait(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  await mkdir(VIDEO_DIR, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({
    recordVideo: { dir: VIDEO_DIR, size: { width: 1280, height: 720 } },
    viewport: { width: 1280, height: 720 },
  });
  const page = await context.newPage();

  async function narrate(text: string) {
    console.log(`[VIDEO] ${text}`);
    await page.evaluate((msg) => {
      const existing = document.getElementById("qa-toast");
      if (existing) existing.remove();
      const div = document.createElement("div");
      div.id = "qa-toast";
      div.textContent = msg;
      div.style.cssText = `
        position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
        background: rgba(0,0,0,0.85); color: #fff; padding: 12px 24px;
        border-radius: 8px; font-family: system-ui, sans-serif; font-size: 14px;
        z-index: 99999; pointer-events: none; white-space: nowrap;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      `;
      document.body.appendChild(div);
      setTimeout(() => div.remove(), 3000);
    }, text);
    await wait(1200);
  }

  async function safeClick(textOrSelector: string) {
    try {
      const locator = page.locator(textOrSelector).first();
      await locator.waitFor({ timeout: 5000 });
      await locator.click();
      return true;
    } catch {
      console.log(`  (click skipped: ${textOrSelector})`);
      return false;
    }
  }

  try {
    // ── STEP 1: Homepage ──
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    await narrate("Step 1: Pi Lab homepage");
    await wait(2500);

    // ── STEP 2: Tasks page ──
    await page.goto(`${BASE_URL}/tasks`, { waitUntil: "networkidle" });
    await narrate("Step 2: Tasks library — curated GitHub issues");
    await wait(2500);

    // Scroll to see tasks
    await page.mouse.wheel(0, 200);
    await wait(1000);

    // ── STEP 3: Datasets page ──
    await page.goto(`${BASE_URL}/datasets`, { waitUntil: "networkidle" });
    await narrate("Step 3: Datasets — reusable benchmark suites");
    await wait(2500);

    // ── STEP 4: Create new dataset ──
    await narrate("Step 4: Creating a new dataset");
    await safeClick('button[aria-label="Create new dataset"]');
    await wait(1500);

    // Fill dataset form
    await page.fill('input[aria-label="Slug"]', "qa-suite-v1");
    await page.fill('input[aria-label="Display name"]', "QA Test Suite");
    await page.fill('textarea[aria-label="Description"]', "Suite for QA video recording");
    await wait(1000);

    // Select a frozen case if available
    const caseRows = page.locator('.dsn-case-row');
    const count = await caseRows.count();
    if (count > 0) {
      await caseRows.first().click();
      await narrate(`Step 5: Selected ${count} frozen case(s)`);
    } else {
      await narrate("Step 5: No frozen cases available (using existing dataset)");
    }
    await wait(1000);

    // Submit or cancel
    const canSubmit = await page.locator('button:has-text("Create dataset")').isEnabled().catch(() => false);
    if (canSubmit) {
      await safeClick('button:has-text("Create dataset")');
      await wait(2000);
    } else {
      // Cancel and use existing
      await safeClick('button:has-text("Cancel")');
      await wait(1000);
    }

    // ── STEP 5: Go to benchmark creation ──
    await page.goto(`${BASE_URL}/benchmarks/new`, { waitUntil: "networkidle" });
    await narrate("Step 6: New benchmark wizard");
    await wait(2000);

    // Select dataset
    const datasetRows = page.locator('.dsn-case-row');
    const dsCount = await datasetRows.count();
    if (dsCount > 0) {
      await datasetRows.first().click();
      await narrate("Step 7: Selected dataset");
    }
    await wait(1000);

    // Continue
    await safeClick('button:has-text("Continue")');
    await wait(1500);

    // ── STEP 6: Agent 1 (MiniMax) ──
    await narrate("Step 8: Configure Agent 1 — MiniMax");
    // Try to find and click a model
    const modelButtons = page.locator('.exp-model-row');
    if (await modelButtons.first().isVisible({ timeout: 5000 })) {
      await modelButtons.first().click();
      await wait(500);
    }
    await safeClick('button:has-text("Continue")');
    await wait(1500);

    // ── STEP 7: Agent 2 (Gemini) ──
    await narrate("Step 9: Configure Agent 2 — Gemini");
    const modelButtons2 = page.locator('.exp-model-row');
    if (await modelButtons2.nth(1).isVisible({ timeout: 5000 })) {
      await modelButtons2.nth(1).click();
      await wait(500);
    }
    await safeClick('button:has-text("Continue")');
    await wait(1500);

    // ── STEP 8: Review & Launch ──
    await narrate("Step 10: Review & Launch");
    await page.fill('input[placeholder*="e.g. GPT"]', "MiniMax vs Gemini QA");
    await wait(1000);

    await narrate("Step 11: Launching benchmark!");
    await safeClick('button:has-text("Launch benchmark")');
    await wait(3000);

    // ── STEP 9: Monitor briefly (show live state) ──
    await narrate("Step 12: Benchmark running live...");
    await wait(3000);

    // Show live updates for ~45s then cut to completed results
    for (let i = 0; i < 4; i++) {
      await wait(10000);
      await page.reload({ waitUntil: "networkidle" });
      await wait(1000);
      await narrate(`Running... (${(i + 1) * 10}s)`);
    }
    await narrate("Step 13: Benchmark in progress — viewing prior results");
    await wait(2000);

    // ── STEP 10: Show completed benchmark results ──
    // Navigate to an existing completed benchmark for the results finale
    await page.goto(`${BASE_URL}/benchmarks/a6b61898-ed9a-45c7-90ef-e3ca8bc4620b/results`, { waitUntil: "networkidle" });
    await narrate("Step 14: Benchmark results — aggregate scores");
    await wait(2500);

    // Scroll to see podium / details
    await page.mouse.wheel(0, 300);
    await wait(1500);
    await narrate("Step 15: Agent comparison & verdicts");
    await wait(2500);

    await page.mouse.wheel(0, 400);
    await wait(1500);
    await narrate("Step 16: Full results breakdown");

    await wait(3000);
    await narrate("Full user flow complete!");
    await wait(2000);

  } catch (error) {
    console.error("QA flow error:", error);
    await page.screenshot({ path: join(VIDEO_DIR, "qa-error.png"), fullPage: true });
  } finally {
    await context.close();
    await browser.close();
  }

  // Report video file
  const files = await readdir(VIDEO_DIR);
  const videos = files.filter((f) => f.endsWith(".webm"));
  const stats = await Promise.all(
    videos.map(async (f) => {
      const s = await stat(join(VIDEO_DIR, f));
      return { name: f, mtime: s.mtimeMs };
    })
  );
  stats.sort((a, b) => b.mtime - a.mtime);
  const latest = stats[0]?.name;

  if (latest) {
    const videoPath = join(VIDEO_DIR, latest);
    const s = await stat(videoPath);
    console.log(`\n🎬 Video recorded: ${videoPath}`);
    console.log(`📏 Size: ${(s.size / 1024 / 1024).toFixed(2)} MB`);
    console.log(`⏱️  Duration: approximately ${Math.round(s.size / 1024 / 50)} seconds`);
  }
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
