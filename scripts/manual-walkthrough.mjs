// Manual Playwright walkthrough — visits every major page on the audit
// branch and screenshots it. Surfaces any console errors / failed network
// requests as it goes. Not part of the test suite; one-off used to verify
// the round-2 audit changes haven't visibly broken anything.
//
// Assumes `pnpm dev:e2e` is already running on PLAYWRIGHT_PORT (default 3002)
// and the e2e DB has been migrated.
//
// Usage: node scripts/manual-walkthrough.mjs

import { chromium } from '/home/user/showbook/node_modules/.pnpm/playwright@1.59.1/node_modules/playwright/index.mjs';
import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const PORT = process.env.PLAYWRIGHT_PORT ?? '3002';
const BASE = `https://localhost:${PORT}`;
const OUT_DIR = join(process.cwd(), 'walkthrough-screenshots');
const EXEC = process.env.PLAYWRIGHT_CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1217/chrome-linux64/chrome';

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch({ executablePath: EXEC, headless: true });
const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

const consoleErrors = [];
const networkFailures = [];

page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push({ text: msg.text(), url: page.url() });
});
page.on('requestfailed', (req) => {
  // Ignore noise from cancelled prefetches / favicon mismatches.
  const failure = req.failure()?.errorText ?? 'unknown';
  if (failure.includes('ERR_ABORTED') || failure.includes('NS_BINDING_ABORTED')) return;
  networkFailures.push({ url: req.url(), method: req.method(), failure });
});
page.on('response', (resp) => {
  if (resp.status() >= 500) {
    networkFailures.push({ url: resp.url(), method: resp.request().method(), failure: `HTTP ${resp.status()}` });
  }
});

async function step(name, fn) {
  process.stdout.write(`→ ${name} ... `);
  try {
    await fn();
    await page.screenshot({ path: join(OUT_DIR, `${String(steps).padStart(2, '0')}-${name}.png`), fullPage: true });
    console.log('OK');
    steps += 1;
  } catch (err) {
    console.log(`FAILED: ${err.message}`);
    await page.screenshot({ path: join(OUT_DIR, `${String(steps).padStart(2, '0')}-${name}-FAIL.png`), fullPage: true }).catch(() => {});
    throw err;
  }
}

let steps = 0;

try {
  // Sign in via test endpoint and seed.
  await step('signin', async () => {
    await page.goto(`${BASE}/api/test/login`, { waitUntil: 'networkidle' });
    await page.waitForURL(/\/home/, { timeout: 10_000 });
  });

  await step('seed', async () => {
    const res = await page.goto(`${BASE}/api/test/seed`);
    if (!res || !res.ok()) throw new Error(`seed returned ${res?.status()}`);
    await page.goto(`${BASE}/home`, { waitUntil: 'networkidle' });
  });

  await step('home', async () => {
    await page.goto(`${BASE}/home`, { waitUntil: 'networkidle' });
    await page.waitForLoadState('networkidle');
  });

  await step('shows', async () => {
    await page.goto(`${BASE}/shows`, { waitUntil: 'networkidle' });
  });

  await step('shows-detail', async () => {
    // Click the first row's headliner link if present.
    const firstRow = page.locator('a[href^="/shows/"]').first();
    if (await firstRow.count()) {
      await firstRow.click();
      await page.waitForLoadState('networkidle');
    } else {
      console.log(' (no shows; skipping detail)');
    }
  });

  await step('venues', async () => {
    await page.goto(`${BASE}/venues`, { waitUntil: 'networkidle' });
  });

  await step('venues-detail', async () => {
    const firstRow = page.locator('a[href^="/venues/"]').first();
    if (await firstRow.count()) {
      await firstRow.click();
      await page.waitForLoadState('networkidle');
    }
  });

  await step('artists', async () => {
    await page.goto(`${BASE}/artists`, { waitUntil: 'networkidle' });
  });

  await step('artists-detail', async () => {
    const firstRow = page.locator('a[href^="/artists/"]').first();
    if (await firstRow.count()) {
      await firstRow.click();
      await page.waitForLoadState('networkidle');
    }
  });

  await step('discover', async () => {
    await page.goto(`${BASE}/discover`, { waitUntil: 'networkidle' });
  });

  await step('add', async () => {
    await page.goto(`${BASE}/add`, { waitUntil: 'networkidle' });
  });

  await step('map', async () => {
    await page.goto(`${BASE}/map`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500); // Leaflet tile settle
  });

  await step('preferences', async () => {
    await page.goto(`${BASE}/preferences`, { waitUntil: 'networkidle' });
  });
} finally {
  await browser.close();
}

console.log('');
console.log('=== Console errors ===');
if (!consoleErrors.length) console.log('  none');
for (const e of consoleErrors) console.log(`  [${e.url}] ${e.text}`);
console.log('=== Network failures (excluding aborts) ===');
if (!networkFailures.length) console.log('  none');
for (const e of networkFailures) console.log(`  ${e.method} ${e.url} -> ${e.failure}`);
console.log('');
console.log(`${steps} steps, screenshots in ${OUT_DIR}`);
process.exit(consoleErrors.length || networkFailures.length ? 1 : 0);
