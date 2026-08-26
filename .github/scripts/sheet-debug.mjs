// Manual debugging aid, not a real test suite -- drives the deployed app
// with a throwaway test account to capture real DOM/layout numbers and
// screenshots for the New Transaction sheet, across both Chromium and
// WebKit at an iPhone viewport. Triggered by hand via the
// "Sheet layout debug" workflow, not run on every push.
import { chromium, webkit, devices } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";

// Strips any trailing slash(es) -- a URL pasted with one (the input's
// "no trailing slash" hint is easy to miss) would otherwise produce
// `${TARGET_URL}/login` as a double slash, which some hosts don't route
// to the actual login page, leaving the password field to never appear.
const TARGET_URL = process.env.TARGET_URL?.replace(/\/+$/, "");
const EMAIL = process.env.TEST_EMAIL;
const PASSWORD = process.env.TEST_PASSWORD;

if (!TARGET_URL || !EMAIL || !PASSWORD) {
  console.error("Missing TARGET_URL / TEST_EMAIL / TEST_PASSWORD env vars");
  process.exit(1);
}

mkdirSync("artifacts", { recursive: true });

const device = devices["iPhone 14"];

// One engine's failure shouldn't stop the other from running, and a
// failure with no screenshot/HTML to show for it just repeats last
// time's problem (a bare timeout, no idea what page was actually on
// screen) -- so every step is wrapped to always leave a diagnostic trail
// in artifacts/ even when something goes wrong.
async function run(engine, label) {
  const browser = await engine.launch();
  const context = await browser.newContext({ ...device });
  const page = await context.newPage();

  const consoleLines = [];
  page.on("console", (msg) => consoleLines.push(`[console] ${msg.text()}`));
  page.on("pageerror", (err) => consoleLines.push(`[pageerror] ${err.message}`));

  try {
    await page.goto(`${TARGET_URL}/login`, { waitUntil: "networkidle" });
    console.log(`[${label}] login page URL: ${page.url()}`);

    await page.fill('input[type="email"]', EMAIL);
    await page.fill('input[type="password"]', PASSWORD);
    await page.click('button:has-text("Sign In")');
    await page.waitForURL(/dashboard/, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1000);

    console.log(`[${label}] post-login URL: ${page.url()}`);

    // Login can fail (bad creds, a captcha check, rate limiting, etc.)
    // without ever navigating away from /login -- the app shows the
    // reason in a `.text-rust` paragraph rather than throwing, so read
    // it directly instead of only inferring failure from the FAB never
    // appearing three steps later.
    if (page.url().includes("/login")) {
      const loginError = await page.locator(".text-rust").first().textContent().catch(() => null);
      console.log(`[${label}] still on /login -- on-page error: ${loginError ?? "(none shown)"}`);
    }

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
  } catch (err) {
    console.error(`[${label}] failed:`, err.message);
    writeFileSync(`artifacts/${label}-error.txt`, `${err.message}\n\nPage URL at failure: ${page.url()}`);
    writeFileSync(`artifacts/${label}-page.html`, await page.content().catch(() => "(could not read page content)"));
  } finally {
    writeFileSync(`artifacts/${label}-console.log`, consoleLines.join("\n"));
    await page.screenshot({ path: `artifacts/${label}-sheet.png` }).catch(() => {});
    await browser.close();
  }
}

await run(chromium, "chromium");
await run(webkit, "webkit");
