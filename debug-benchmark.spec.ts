import { test, chromium } from "@playwright/test";

test("debug benchmark creation", async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on("request", (req) => {
    if (req.url().includes("/benchmarks") && req.method() === "POST") {
      const data = req.postData();
      console.log("POST /benchmarks payload:", data);
    }
  });

  page.on("response", async (res) => {
    if (res.url().includes("/benchmarks") && res.request().method() === "POST") {
      const text = await res.text().catch(() => "");
      console.log("POST /benchmarks response:", res.status(), text.slice(0, 500));
    }
  });

  await page.goto("http://localhost:3000/benchmarks/new", { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);

  // Select dataset
  await page.locator('.dsn-case-row:has-text("react-suite-v1")').first().click();
  await page.waitForTimeout(500);
  await page.locator('button:has-text("Continue")').first().click();
  await page.waitForTimeout(1000);

  // Agent 1
  await page.locator('input[aria-label="Search models"]').fill("mimo-v2-flash");
  await page.waitForTimeout(500);
  await page.locator('.exp-model-row:has-text("xiaomi/mimo-v2-flash")').first().click();
  await page.locator('button:has-text("Plan only")').first().click();
  await page.locator('button:has-text("Continue")').first().click();
  await page.waitForTimeout(1000);

  // Agent 2
  await page.locator('input[aria-label="Search models"]').fill("gemini-3.1-flash-lite");
  await page.waitForTimeout(500);
  await page.locator('.exp-model-row:has-text("google/gemini-3.1-flash-lite")').first().click();
  await page.locator('button:has-text("Plan only")').first().click();
  await page.locator('button:has-text("Continue")').first().click();
  await page.waitForTimeout(1000);

  // Name
  const anyInput = page.locator('.wz-card#review input').first();
  await anyInput.fill("react-suite-v1-benchmark");
  await page.waitForTimeout(500);

  // Launch
  await page.locator('button:has-text("Launch benchmark")').click();
  await page.waitForTimeout(5000);

  await context.close();
  await browser.close();
});
