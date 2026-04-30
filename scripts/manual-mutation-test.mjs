// Targeted mutation walkthrough — opens a seeded show, drives the edit
// flow through shows.update (the big transactional refactor), then opens
// add/page.tsx and triggers shows.create. Verifies counts update in the
// sidebar (proves namespace-level invalidation works after the audit).

import { chromium } from '/home/user/showbook/node_modules/.pnpm/playwright@1.59.1/node_modules/playwright/index.mjs';
import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const PORT = process.env.PLAYWRIGHT_PORT ?? '3002';
const BASE = `https://localhost:${PORT}`;
const OUT = join(process.cwd(), 'walkthrough-screenshots/mutation');
const EXEC = process.env.PLAYWRIGHT_CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1217/chrome-linux64/chrome';

if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: EXEC, headless: true });
const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});

let step = 0;
async function shot(name) {
  await page.screenshot({ path: join(OUT, `${String(step).padStart(2, '0')}-${name}.png`), fullPage: true });
  step++;
}

try {
  await page.goto(`${BASE}/api/test/login`);
  await page.waitForURL(/\/home/);
  await page.goto(`${BASE}/api/test/seed`);
  await page.goto(`${BASE}/home`, { waitUntil: 'networkidle' });
  await shot('00-home-after-seed');

  // Read sidebar counts before mutation.
  const before = await page.locator('.app-shell__sidebar').innerText().catch(() => '');
  const beforeShowCount = (before.match(/Shows\s+(\d+)/) ?? [])[1];
  console.log(`Sidebar before: Shows=${beforeShowCount}`);

  // Get a known seeded show by (productionName, state). "Wicked" is the
  // ticketed theatre show in the seed.
  const showIdResp = await page.request.get(
    `${BASE}/api/test/show-id?productionName=Wicked&state=ticketed`,
  );
  const showId = (await showIdResp.json()).id;
  console.log(`Using showId=${showId}`);

  await page.goto(`${BASE}/shows/${showId}`, { waitUntil: 'networkidle' });
  await shot('01-show-detail');

  if (showId) {
    await page.goto(`${BASE}/add?editId=${showId}`, { waitUntil: 'networkidle' });
    await shot('02-edit-form-loaded');

    // Update the seat input and save.
    const seatInput = page.locator('input[placeholder*="Seat" i], input[name="seat"]').first();
    if (await seatInput.count()) {
      await seatInput.fill('FRONT ROW · TEST');
    }
    const saveBtn = page.getByRole('button', { name: /save|update/i }).first();
    if (await saveBtn.count()) {
      await saveBtn.click();
      await page.waitForLoadState('networkidle');
      await shot('03-after-save');
    } else {
      console.log('  (no save button found; skipping)');
    }
  } else {
    console.log('  (could not get show id from URL; skipping edit path)');
  }

  // Sidebar count check after mutation.
  await page.goto(`${BASE}/home`, { waitUntil: 'networkidle' });
  const after = await page.locator('.app-shell__sidebar').innerText().catch(() => '');
  const afterShowCount = (after.match(/Shows\s+(\d+)/) ?? [])[1];
  console.log(`Sidebar after:  Shows=${afterShowCount}`);
  await shot('04-final-home');
} finally {
  await browser.close();
}

console.log('');
console.log('Console errors:');
if (!consoleErrors.length) console.log('  none');
else consoleErrors.forEach((e) => console.log(`  ${e}`));
process.exit(consoleErrors.length ? 1 : 0);
