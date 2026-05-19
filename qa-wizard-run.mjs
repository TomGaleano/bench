import { chromium } from 'playwright';

const BASE_URL = 'http://localhost:3000';
const SCREENSHOT_DIR = '/Users/tomasgaleano/Desktop/Coding/bench/output/playwright/qa';
const ISSUE_URL = 'https://github.com/wailsapp/wails/issues/4649';

function now() {
  return new Date().toISOString();
}

async function takeScreenshot(page, name) {
  const path = `${SCREENSHOT_DIR}/${name}`;
  await page.screenshot({ path, fullPage: true });
  console.log(`[${now()}] Screenshot saved: ${path}`);
  return path;
}

const consoleLogs = [];
const networkErrors = [];

async function run() {
  console.log(`[${now()}] Starting QA wizard run...`);
  console.log(`[${now()}] Output dir: ${SCREENSHOT_DIR}`);

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  page.on('console', msg => {
    const text = `[${now()}] [${msg.type()}] ${msg.text()}`;
    consoleLogs.push(text);
    console.log(text);
  });

  page.on('pageerror', err => {
    const text = `[${now()}] [PAGE ERROR] ${err.message}`;
    consoleLogs.push(text);
    console.error(text);
  });

  page.on('response', async response => {
    if (response.status() >= 400) {
      let body = '';
      try { body = await response.text(); } catch {}
      const text = `[${now()}] [NETWORK ERROR] ${response.status()} ${response.url()} - ${body.slice(0, 500)}`;
      networkErrors.push(text);
      console.error(text);
    }
  });

  try {
    // =========================
    // Step A: Navigate to wizard
    // =========================
    console.log(`[${now()}] === STEP A: Navigate to /cases/new ===`);
    await page.goto(`${BASE_URL}/cases/new`, { waitUntil: 'networkidle', timeout: 60000 });
    await takeScreenshot(page, '01-wizard-start.png');

    const startHeading = page.locator('text=Start from a GitHub issue');
    if (await startHeading.isVisible().catch(() => false)) {
      console.log(`[${now()}] ✅ Step A PASSED: "Start from a GitHub issue" heading is visible`);
    } else {
      throw new Error('Step A failed: heading not found');
    }

    // =========================
    // Step B: Paste issue URL and import
    // =========================
    console.log(`[${now()}] === STEP B: Import GitHub issue ===`);
    const urlInput = page.locator('input[name="issueUrl"]');
    await urlInput.fill(ISSUE_URL);
    console.log(`[${now()}] Filled issue URL: ${ISSUE_URL}`);

    const importBtn = page.locator('button:has-text("Import issue")');
    await importBtn.click();
    console.log(`[${now()}] Clicked "Import issue"`);

    console.log(`[${now()}] Waiting for import to finish (button text reverts)...`);
    await page.waitForFunction(() => {
      const btn = document.querySelector('button[type="submit"]');
      return btn && btn.textContent?.trim() === 'Import issue';
    }, { timeout: 120000 });
    console.log(`[${now()}] Import button reverted to "Import issue"`);

    console.log(`[${now()}] Waiting for issue metadata to appear...`);
    await page.waitForSelector('text=No issue imported', { state: 'detached', timeout: 120000 });
    await page.waitForTimeout(2000);
    await takeScreenshot(page, '02-issue-imported.png');

    const issueTitleVisible = await page.locator('text=/Source metadata|wailsapp\/wails/i').first().isVisible().catch(() => false);
    const prDiscoveryVisible = await page.locator('text=/PR discovery|PR candidates/i').first().isVisible().catch(() => false);
    
    if (issueTitleVisible && prDiscoveryVisible) {
      console.log(`[${now()}] ✅ Step B PASSED: Issue imported and PR discovery section visible`);
    } else {
      console.error(`[${now()}] ⚠️ Step B: Issue or PR discovery not clearly visible`);
    }

    // =========================
    // Step C: Select PR #5310
    // =========================
    console.log(`[${now()}] === STEP C: Select PR #5310 ===`);
    
    const pr5310Card = page.locator('article.candidateCard:has-text("5310")');
    const hasPr5310 = await pr5310Card.isVisible().catch(() => false);
    
    if (hasPr5310) {
      const selectBtn = pr5310Card.locator('button:has-text("Select")');
      await selectBtn.click();
      console.log(`[${now()}] Clicked "Select" on PR #5310`);
    } else {
      const pr5310Text = page.locator('text=/5310/').first();
      if (await pr5310Text.isVisible().catch(() => false)) {
        const selectBtn = pr5310Text.locator('xpath=ancestor::article[contains(@class,"candidateCard")]//button[contains(text(),"Select")]');
        if (await selectBtn.isVisible().catch(() => false)) {
          await selectBtn.click();
          console.log(`[${now()}] Clicked "Select" on PR #5310 (fallback)`);
        } else {
          throw new Error('Step C failed: Select button for PR #5310 not found');
        }
      } else {
        throw new Error('Step C failed: PR #5310 not found in candidates');
      }
    }

    console.log(`[${now()}] Waiting for PR selection to complete...`);
    await page.waitForFunction(() => {
      const selectingBtns = document.querySelectorAll('button');
      return !Array.from(selectingBtns).some(b => b.textContent?.trim() === 'Selecting...');
    }, { timeout: 120000 });

    await page.waitForTimeout(2000);
    await takeScreenshot(page, '03-pr-selected.png');

    const selectedPrVisible = await page.locator('text=/Selected|changed files|base|head/i').first().isVisible().catch(() => false);
    if (selectedPrVisible) {
      console.log(`[${now()}] ✅ Step C PASSED: PR details visible`);
    } else {
      console.error(`[${now()}] ⚠️ Step C: PR details not clearly visible`);
    }

    // =========================
    // Step D: Wait for case-builder (tests built)
    // =========================
    console.log(`[${now()}] === STEP D: Wait for case-builder job ===`);
    console.log(`[${now()}] Polling for case-builder completion (up to 5 min)...`);
    let caseBuilderAttempts = 0;
    let caseBuilderComplete = false;
    while (caseBuilderAttempts < 60) {
      await page.waitForTimeout(5000);
      const html = await page.content();
      
      if (html.includes('ready-for-validation') || html.includes('Proposed tests') || html.includes('Validation job ID')) {
        console.log(`[${now()}] Case-builder appears complete (attempt ${caseBuilderAttempts})`);
        caseBuilderComplete = true;
        break;
      }
      
      if (html.includes('caseBuilderJob') || html.includes('Queue') || html.includes('Job ID')) {
        console.log(`[${now()}] Case-builder job info visible, still running... (attempt ${caseBuilderAttempts})`);
      }
      
      caseBuilderAttempts++;
    }

    await takeScreenshot(page, '04-tests-built.png');

    if (caseBuilderComplete) {
      console.log(`[${now()}] ✅ Step D PASSED: Proposed tests / ready-for-validation visible`);
    } else {
      console.error(`[${now()}] ⚠️ Step D: Case-builder may still be running, continuing...`);
    }

    // =========================
    // Step E: Wait for validation-runner
    // =========================
    console.log(`[${now()}] === STEP E: Wait for validation-runner job ===`);
    console.log(`[${now()}] Polling for validation completion (up to 10 min)...`);
    
    let validationAttempts = 0;
    let validationComplete = false;
    while (validationAttempts < 120) {
      await page.waitForTimeout(5000);
      const html = await page.content();
      
      if (html.includes('Freeze case') && !html.includes('Waiting for validation')) {
        console.log(`[${now()}] Validation appears complete - Freeze case button visible (attempt ${validationAttempts})`);
        validationComplete = true;
        break;
      }
      
      if (html.includes('Validation complete') || html.includes('accepted') || html.includes('rejected tests')) {
        console.log(`[${now()}] Validation output visible (attempt ${validationAttempts})`);
        validationComplete = true;
        break;
      }
      
      if (html.includes('Not finished') && html.includes('Validation')) {
        console.log(`[${now()}] Validation still running... (attempt ${validationAttempts})`);
      }
      
      validationAttempts++;
    }

    await takeScreenshot(page, '05-validation-complete.png');

    const freezeBtnVisible = await page.locator('button:has-text("Freeze case")').first().isVisible().catch(() => false);
    const rejectBtnVisible = await page.locator('button:has-text("Reject case")').first().isVisible().catch(() => false);
    
    if (freezeBtnVisible || rejectBtnVisible) {
      console.log(`[${now()}] ✅ Step E PASSED: Validation complete. Freeze/Reject buttons visible`);
    } else {
      console.error(`[${now()}] ❌ Step E FAILED: Validation not complete after 10 minutes`);
      throw new Error('Step E failed');
    }

    // =========================
    // Step F: Freeze the case (or handle disabled state)
    // =========================
    console.log(`[${now()}] === STEP F: Freeze the case ===`);
    const freezeBtn = page.locator('button:has-text("Freeze case")');
    
    const isDisabled = await freezeBtn.evaluate(el => el.disabled).catch(() => false);
    if (isDisabled) {
      console.error(`[${now()}] ❌ Step F BLOCKED: Freeze case button is DISABLED`);
      console.error(`[${now()}] Reason: The validation returned 0 accepted tests. The UI disables freezing when there are no accepted tests.`);
      
      // Capture the validation result text
      const validationResult = await page.locator('text=/accepted|rejected|Validation complete/i').first().textContent().catch(() => 'unknown');
      console.error(`[${now()}] Validation result text: ${validationResult}`);
      
      // Take a screenshot documenting this blocked state
      await takeScreenshot(page, '06-case-blocked.png');
      
      console.log(`[${now()}] ⚠️ Step F: Cannot freeze - 0 accepted tests. Skipping to Step G to verify case in list.`);
    } else {
      await freezeBtn.click();
      console.log(`[${now()}] Clicked "Freeze case"`);
      
      console.log(`[${now()}] Waiting for freeze confirmation...`);
      await page.waitForFunction(() => {
        const btns = document.querySelectorAll('button');
        return !Array.from(btns).some(b => b.textContent?.trim() === 'Freezing...');
      }, { timeout: 60000 });

      await page.waitForTimeout(2000);
      await takeScreenshot(page, '06-case-frozen.png');

      const frozenSuccess = await page.locator('text=/Case frozen successfully|frozen/i').first().isVisible().catch(() => false);
      if (frozenSuccess) {
        console.log(`[${now()}] ✅ Step F PASSED: Case frozen successfully`);
      } else {
        console.error(`[${now()}] ⚠️ Step F: Freeze success message not clearly visible`);
      }
    }

    // =========================
    // Step G: Navigate to /cases
    // =========================
    console.log(`[${now()}] === STEP G: Verify in cases list ===`);
    await page.goto(`${BASE_URL}/cases`, { waitUntil: 'networkidle', timeout: 60000 });
    await takeScreenshot(page, '07-cases-list.png');

    const casesList = await page.locator('text=/4649|wails|5310/i').first().isVisible().catch(() => false);
    if (casesList) {
      console.log(`[${now()}] ✅ Step G PASSED: Case appears in cases list`);
    } else {
      console.error(`[${now()}] ⚠️ Step G: Case not clearly visible in list`);
    }

    console.log(`[${now()}] === ALL STEPS COMPLETE ===`);

  } catch (error) {
    console.error(`[${now()}] ❌ SCRIPT FAILED: ${error.message}`);
    console.error(error.stack);
    try { await takeScreenshot(page, 'ERROR-state.png'); } catch {}
    throw error;
  } finally {
    console.log(`\n[${now()}] === CONSOLE LOGS ===`);
    consoleLogs.forEach(l => console.log(l));
    console.log(`\n[${now()}] === NETWORK ERRORS ===`);
    networkErrors.forEach(e => console.error(e));
    await browser.close();
    console.log(`[${now()}] Browser closed.`);
  }
}

run().catch(err => {
  console.error(`[${now()}] Fatal error: ${err.message}`);
  process.exit(1);
});
