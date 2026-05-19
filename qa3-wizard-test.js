const { chromium } = require('playwright');
const path = require('path');

const SCREENSHOT_DIR = '/Users/tomasgaleano/Desktop/Coding/bench/output/playwright/qa3';
const BASE_URL = 'http://localhost:3000';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function takeScreenshot(page, name) {
  const filePath = path.join(SCREENSHOT_DIR, name);
  await page.screenshot({ path: filePath, fullPage: true });
  console.log(`📸 Screenshot saved: ${name}`);
}

async function pollForCondition(conditionFn, intervalMs, timeoutMs, description) {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    const result = await conditionFn();
    if (result) {
      return result;
    }
    console.log(`  ${description} - polling... (${Math.round((Date.now() - startTime) / 1000)}s elapsed)`);
    await sleep(intervalMs);
  }
  return null;
}

(async () => {
  console.log('🚀 Starting Pi Lab wizard end-to-end test');
  console.log(`📂 Screenshots will be saved to: ${SCREENSHOT_DIR}`);
  
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  
  try {
    // Step 1: Navigate to /cases/new
    console.log('\n📍 Step 1: Navigating to /cases/new');
    await page.goto(`${BASE_URL}/cases/new`, { waitUntil: 'networkidle', timeout: 30000 });
    await takeScreenshot(page, '01-wizard-start.png');
    
    // Check current wizard state
    const stepText = await page.$eval('.step-indicator, [class*="step"]', el => el.textContent).catch(() => '');
    console.log(`  Current wizard state: ${stepText}`);
    
    // Check if issue is already imported
    const hasIssue = await page.$('text=pallets/click#3105').catch(() => null);
    if (!hasIssue) {
      console.log('\n📍 Step 2: Pasting issue URL and importing');
      const inputs = await page.locator('input, textarea').all();
      let issueInput = null;
      for (const input of inputs) {
        const placeholder = await input.evaluate(el => el.placeholder || '');
        if (placeholder.includes('github.com/owner/repo')) {
          issueInput = input;
          break;
        }
      }
      if (!issueInput) throw new Error('Could not find issue URL input');
      await issueInput.fill('https://github.com/pallets/click/issues/3105');
      
      const importBtn = await page.waitForSelector('button:has-text("Import issue")', { timeout: 10000 });
      await importBtn.click();
      
      console.log('  Waiting for issue import (~5-20s)...');
      await page.waitForSelector('text=pallets/click#3105', { timeout: 30000 });
      await sleep(3000);
    } else {
      console.log('  Issue already imported, skipping import step');
    }
    await takeScreenshot(page, '02-issue-imported.png');
    
    // Check if PR is selected
    const hasPrSelected = await page.$('text=Selected pallets/click#3211').catch(() => null);
    if (!hasPrSelected) {
      console.log('\n📍 Step 3: Selecting PR #3211');
      const allSelectBtns = await page.locator('button:has-text("Select")').all();
      let prSelectBtn = null;
      for (const btn of allSelectBtns) {
        const isVisible = await btn.isVisible().catch(() => false);
        if (isVisible) {
          prSelectBtn = btn;
          break;
        }
      }
      if (!prSelectBtn) {
        throw new Error('Could not find Select button for PR #3211');
      }
      await prSelectBtn.click();
      console.log('  Waiting for PR details to load...');
      await sleep(3000);
    } else {
      console.log('  PR #3211 already selected, skipping selection step');
    }
    await takeScreenshot(page, '03-pr-selected.png');
    
    // Check if we're already in validation or need to continue to tests
    const isInValidation = await page.$('text=Waiting for validation, text=ready-for-validation').catch(() => null);
    const hasFreezeButton = await page.$('button:has-text("Freeze case"):visible').catch(() => null);
    
    if (!isInValidation && !hasFreezeButton) {
      console.log('\n📍 Step 4: Continuing to case builder');
      const continueBtn = await page.$('button:has-text("Continue"):visible');
      if (continueBtn) {
        await continueBtn.click();
      }
      
      console.log('  Waiting for case-builder job (~30-120s)...');
      const testsBuilt = await pollForCondition(async () => {
        const hasContinue = await page.$('button:has-text("Continue"):visible').catch(() => null);
        const hasError = await page.$('text=error:visible').catch(() => null);
        const hasValidation = await page.$('text=Waiting for validation:visible').catch(() => null);
        return hasContinue || hasError || hasValidation;
      }, 3000, 3 * 60 * 1000, 'Case builder');
      
      if (!testsBuilt) {
        console.error('  ❌ Case builder timed out');
        await takeScreenshot(page, '04-tests-built-timeout.png');
        throw new Error('Case builder timed out');
      }
      
      await sleep(2000);
      await takeScreenshot(page, '04-tests-built.png');
    } else {
      console.log('  Already in validation or tests built, skipping case builder step');
    }
    
    // Step 5: Wait for validation
    console.log('\n📍 Step 5: Waiting for validation with Docker evaluator (~3-15 min)...');
    const validationComplete = await pollForCondition(async () => {
      const freezeBtn = await page.$('button:has-text("Freeze case"):visible').catch(() => null);
      const rejectBtn = await page.$('button:has-text("Reject"):visible').catch(() => null);
      const errorMsg = await page.$('text=rejected:visible').catch(() => null);
      return freezeBtn || rejectBtn || errorMsg;
    }, 5000, 20 * 60 * 1000, 'Validation');
    
    if (!validationComplete) {
      console.error('  ❌ Validation timed out');
      await takeScreenshot(page, '05-validation-timeout.png');
      throw new Error('Validation timed out');
    }
    
    await sleep(2000);
    await takeScreenshot(page, '05-validation-complete.png');
    
    // CRITICAL: Verify "Freeze case" button is ENABLED
    console.log('\n📍 Checking "Freeze case" button status...');
    const freezeBtn = await page.$('button:has-text("Freeze case"):visible');
    if (!freezeBtn) {
      console.error('  ❌ "Freeze case" button not found');
      throw new Error('Freeze case button not found');
    }
    
    const isDisabled = await freezeBtn.evaluate(el => el.disabled || el.getAttribute('disabled'));
    console.log(`  Freeze button disabled: ${isDisabled}`);
    
    if (isDisabled) {
      console.error('  ❌ "Freeze case" button is DISABLED - validation may have been rejected');
      
      const acceptedCount = await page.$eval('[data-testid="accepted-count"], .accepted-count', el => el.textContent).catch(() => null);
      const rejectedCount = await page.$eval('[data-testid="rejected-count"], .rejected-count', el => el.textContent).catch(() => null);
      
      console.log('  Validation details:');
      if (acceptedCount) console.log(`    Accepted tests: ${acceptedCount.trim()}`);
      if (rejectedCount) console.log(`    Rejected tests: ${rejectedCount.trim()}`);
      
      throw new Error('Freeze case button is disabled - validation was rejected');
    }
    
    console.log('  ✅ "Freeze case" button is ENABLED');
    
    // Step 6: Freeze the case
    console.log('\n📍 Step 6: Freezing the case');
    await freezeBtn.click();
    
    console.log('  Waiting for confirmation...');
    await page.waitForSelector('text=frozen, text=success', { timeout: 30000 }).catch(() => {});
    await sleep(3000);
    await takeScreenshot(page, '06-case-frozen.png');
    
    // Step 7: Navigate to /cases
    console.log('\n📍 Step 7: Navigating to /cases');
    await page.goto(`${BASE_URL}/cases`, { waitUntil: 'networkidle', timeout: 30000 });
    await sleep(2000);
    await takeScreenshot(page, '07-cases-list-frozen.png');
    
    console.log('\n✅ END-TO-END TEST COMPLETED SUCCESSFULLY');
    console.log('   The case has been frozen and is visible in the cases list.');
    
  } catch (error) {
    console.error('\n❌ TEST FAILED:');
    console.error(`   ${error.message}`);
    
    try {
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'error-state.png'), fullPage: true });
      console.log('   Error screenshot saved: error-state.png');
    } catch (e) {}
    
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
