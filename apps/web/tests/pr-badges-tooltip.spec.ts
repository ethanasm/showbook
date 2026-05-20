/**
 * One-off PR screenshots for PR #314: per-show setlist indexing fix
 * + Scheme-A badge relabel + mobile tap-to-show tooltip.
 *
 * Gated on `CAPTURE_PR_BADGES=1` so the regular e2e run doesn't pick
 * it up. Run with:
 *   CAPTURE_PR_BADGES=1 pnpm --filter web exec playwright test \
 *     tests/pr-badges-tooltip.spec.ts --project=desktop-dark --workers=1
 *
 * Output PNG suffix is controlled by `PR_BADGES_SUFFIX` so the
 * pr-screenshots loop can shoot the same scenes twice (before / after).
 */

import { test, expect } from '@playwright/test';
import path from 'node:path';
import { loginAndSeedAsWorker, workerShowId } from './helpers/auth';

const HIDE_DEV_INDICATOR = `
  [data-nextjs-toast],
  [data-nextjs-dev-tools-button],
  [data-nextjs-dev-tools-menu],
  nextjs-portal { display: none !important; }
`;

const SUFFIX = process.env.PR_BADGES_SUFFIX ?? 'after';

test.skip(
  process.env.CAPTURE_PR_BADGES !== '1',
  'Set CAPTURE_PR_BADGES=1 to capture PR #314 badge/tooltip screenshots',
);

const SCREENSHOTS_DIR = path.join(__dirname, '..', 'test-results', 'screenshots');

async function shot(page: import('@playwright/test').Page, name: string) {
  await page.screenshot({
    path: path.join(SCREENSHOTS_DIR, `${name}-${SUFFIX}.png`),
    fullPage: false,
  });
}

test('past concert Setlist tab — badges rendered on each song row', async ({ page }) => {
  test.setTimeout(180_000);
  await loginAndSeedAsWorker(page);

  // Radiohead at MSG is seeded as a past show with a 10-song setlist
  // and a support act (LCD Soundsystem). The seed route runs
  // `runSongIndexRebuild` after insert, so the `firstTime` badge
  // ("Your first" / 🆕) fires on every song for the seeded user.
  const showId = await workerShowId(page, {
    headliner: 'Radiohead',
    venueName: 'Madison Square Garden',
    state: 'past',
  });
  expect(showId).not.toBeNull();
  await page.goto(`/shows/${showId}?tab=setlist`);
  // Wait for at least one actual-setlist row to render — the badges
  // hang off these rows.
  await page.waitForSelector('[data-testid="predicted-setlist-row"]', {
    state: 'visible',
    timeout: 30_000,
  });
  // Give the songBadges query a beat to resolve and decorate the rows.
  await page.waitForSelector('[data-testid="predicted-row-badge-first-time"]', {
    state: 'visible',
    timeout: 15_000,
  });
  await page.addStyleTag({ content: HIDE_DEV_INDICATOR });

  // Element-level capture: just the setlist grid. Avoids wasting pixels
  // on header + venue card + tab chrome.
  const grid = page.locator('[data-testid="actual-setlist-grid"]').first();
  await grid.scrollIntoViewIfNeeded();
  const box = await grid.boundingBox();
  expect(box).not.toBeNull();
  await page.screenshot({
    path: path.join(SCREENSHOTS_DIR, `setlist-grid-${SUFFIX}.png`),
    clip: {
      x: Math.max(0, box!.x - 4),
      y: Math.max(0, box!.y - 4),
      width: box!.width + 8,
      // Top portion only — first ~5 rows is enough to see all the
      // badge variants without scrolling.
      height: Math.min(box!.height, 360) + 4,
    },
  });

  // Full-page for context. Slightly smaller per-element delta in this
  // shot but useful to show the badges in their natural row layout.
  await shot(page, 'setlist-tab-full');
});

test('tapping a 🆕 badge opens the tooltip and keeps it sticky (mobile-friendly) — AFTER ONLY', async ({ page }) => {
  test.skip(
    process.env.PR_BADGES_TOOLTIP_TEST !== '1',
    'Set PR_BADGES_TOOLTIP_TEST=1 to capture the tap-tooltip after-only screenshot (skipped on before-run)',
  );
  test.setTimeout(180_000);
  await loginAndSeedAsWorker(page);
  const showId = await workerShowId(page, {
    headliner: 'Radiohead',
    venueName: 'Madison Square Garden',
    state: 'past',
  });
  expect(showId).not.toBeNull();
  await page.goto(`/shows/${showId}?tab=setlist`);
  await page.waitForSelector('[data-testid="predicted-row-badge-first-time"]', {
    state: 'visible',
    timeout: 30_000,
  });
  await page.addStyleTag({ content: HIDE_DEV_INDICATOR });

  // Tap (click) the first 🆕 badge. The Tooltip's onClick promotes to
  // sticky-open; mouseLeave will not dismiss it. This is the explicit
  // mobile-friendly tap-to-show path. Force=true so the click doesn't
  // wait for a fade-in or get blocked by an overlay.
  const firstBadge = page
    .locator('[data-testid="predicted-row-badge-first-time"]')
    .first();
  await firstBadge.scrollIntoViewIfNeeded();
  await firstBadge.click({ force: true });
  // The tooltip mounts into a portal at document.body with
  // role="tooltip" — wait for it to appear before capturing.
  await page.waitForSelector('[role="tooltip"]', { timeout: 5_000 });
  // Move the cursor away to prove the sticky-open path: a non-sticky
  // tooltip would hide on mouseLeave.
  await page.mouse.move(0, 0);
  await page.waitForTimeout(200);
  // The tooltip should STILL be visible.
  expect(await page.locator('[role="tooltip"]').count()).toBeGreaterThan(0);

  // Element-level capture: the row + the floating tooltip. Walk up to
  // the parent row's bounding box and expand vertically to include
  // the tooltip portal that sits above the row.
  const row = firstBadge.locator('xpath=ancestor::*[contains(@class, "predicted-row")][1]');
  const rowBox = await row.boundingBox();
  expect(rowBox).not.toBeNull();
  const tipBox = await page.locator('[role="tooltip"]').first().boundingBox();
  // Union the two bounding boxes with a small margin.
  const x = Math.min(rowBox!.x, tipBox?.x ?? rowBox!.x) - 6;
  const y = Math.min(rowBox!.y, tipBox?.y ?? rowBox!.y) - 6;
  const right = Math.max(
    rowBox!.x + rowBox!.width,
    (tipBox?.x ?? 0) + (tipBox?.width ?? 0),
  ) + 6;
  const bottom = Math.max(
    rowBox!.y + rowBox!.height,
    (tipBox?.y ?? 0) + (tipBox?.height ?? 0),
  ) + 6;
  await page.screenshot({
    path: path.join(SCREENSHOTS_DIR, `badge-tap-tooltip-${SUFFIX}.png`),
    clip: {
      x: Math.max(0, x),
      y: Math.max(0, y),
      width: right - x,
      height: bottom - y,
    },
  });
});
