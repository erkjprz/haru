// Manual debugging aid, not a real test suite -- drives the deployed app
// with a throwaway test account to capture real DOM/layout numbers and
// screenshots for the New Transaction sheet, across both Chromium and
// WebKit at an iPhone viewport. Triggered by hand via the
// "Sheet layout debug" workflow, not run on every push.
import { chromium, webkit, devices } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";

const TARGET_URL = process.env.TARGET_URL;
const EMAIL = process.env.TEST_EMAIL;
const PASSWORD = process.env.TEST_PASSWORD;

if (!TARGET_URL || !EMAIL || !PASSWORD) {
  console.error("Missing TARGET_URL / TEST_EMAIL / TEST_PASSWORD env vars");
  process.exit(1);
}

mkdirSync("artifacts", { recursive: true });

const device = devices["iPhone 14"];

async function run(engine, label) {
  const browser = await engine.launch();
  const context = await browser.newContext({ ...device });
  const page = await context.newPage();

  const consoleLines = [];
  page.on("console", (msg) => consoleLines.push(`[console] ${msg.text()}`));
  page.on("pageerror", (err) => consoleLines.push(`[pageerror] ${err.message}`));

  await page.goto(`${TARGET_URL}/login`, { waitUntil: "networkidle" });
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button:has-text("Sign In")');
  await page.waitForURL(/dashboard/, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1000);

  console.log(`[${label}] post-login URL: ${page.url()}`);

  // Open the FAB's quick-entry sheet.
  const fab = page.getByRole("button", { name: "New Transaction" });
  await fab.click({ timeout: 10000 }).catch(async () => {
    // Fallback if aria-label lookup fails for any reason.
    await page.locator('button[aria-label="New Transaction"]').click();
  });
  await page.waitForTimeout(800);

  const metrics = await page.evaluate(() => {
    const vv = window.visualViewport;
    const panel = document.querySelector(".rounded-t-2xl");
    const submit = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === "Submit");
    const panelRect = panel?.getBoundingClientRect();
    const submitRect = submit?.getBoundingClientRect();
    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      screenHeight: window.screen.height,
      vvHeight: vv?.height,
      standalone: window.matchMedia("(display-mode: standalone)").matches,
      panelRect: panelRect ? { top: panelRect.top, bottom: panelRect.bottom, height: panelRect.height } : null,
      submitRect: submitRect ? { top: submitRect.top, bottom: submitRect.bottom } : null,
      submitClippedPastViewport: submitRect ? submitRect.bottom > window.innerHeight : null
    };
  });

  console.log(`[${label}] metrics:`, JSON.stringify(metrics, null, 2));
  writeFileSync(`artifacts/${label}-metrics.json`, JSON.stringify(metrics, null, 2));
  writeFileSync(`artifacts/${label}-console.log`, consoleLines.join("\n"));
  await page.screenshot({ path: `artifacts/${label}-sheet.png` });

  await browser.close();
}

await run(chromium, "chromium");
await run(webkit, "webkit");
