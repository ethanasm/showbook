/**
 * One-off capture for the Phase-6 setlist-intelligence theatrical +
 * improvised display variants. Skipped unless `CAPTURE_PHASE6=1` is
 * set so this doesn't burden the regular e2e run.
 *
 * Data backing the screenshots is seeded by
 * `scripts/seed-phase6-screenshot-data.mjs` (run before this spec).
 * Both SetlistIntelTheatricalDisplay and SetlistIntelImprovisedDisplay
 * feature flags must be ON for the variants to render — they ship ON
 * by default in this PR.
 */

import { test, expect } from '@playwright/test';
import { loginAsWorker } from './helpers/auth';
import { takeScreenshot } from './helpers/screenshots';

const HIDE_DEV_INDICATOR = `
  [data-nextjs-toast],
  [data-nextjs-dev-tools-button],
  [data-nextjs-dev-tools-menu],
  nextjs-portal { display: none !important; }
`;

const BEYONCE_SHOW_ID = '00000000-0000-4000-8000-bbbbbb000020';
const GIZZARD_SHOW_ID = '00000000-0000-4000-8000-bbbbbb000021';

test.skip(
  process.env.CAPTURE_PHASE6 !== '1',
  'Set CAPTURE_PHASE6=1 to capture Phase-6 setlist-intel screenshots',
);

test('capture theatrical Setlist tab (Beyoncé)', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const projectSlug = testInfo.project.name === 'mobile' ? 'mobile' : 'desktop';
  await loginAsWorker(page);
  await page.goto(`/shows/${BEYONCE_SHOW_ID}?tab=setlist`);
  await expect(page.getByTestId('theatrical-setlist-view')).toBeVisible({
    timeout: 30_000,
  });
  // Wait for the program to fully render — the rotating-slot card
  // is the last item to appear, so once it's visible we know the
  // prediction query resolved + the components mounted.
  await expect(page.getByTestId('rotating-slot-card').first()).toBeVisible();
  await page.addStyleTag({ content: HIDE_DEV_INDICATOR });
  await takeScreenshot(page, `pr-${projectSlug}-phase6-theatrical`);
});

test('capture improvised Setlist tab (King Gizzard)', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const projectSlug = testInfo.project.name === 'mobile' ? 'mobile' : 'desktop';
  await loginAsWorker(page);
  await page.goto(`/shows/${GIZZARD_SHOW_ID}?tab=setlist`);
  await expect(page.getByTestId('improvised-setlist-view')).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByTestId('vibe-sketch-card')).toBeVisible();
  await expect(page.getByTestId('show-mode-odds-card')).toBeVisible();
  await page.addStyleTag({ content: HIDE_DEV_INDICATOR });
  await takeScreenshot(page, `pr-${projectSlug}-phase6-improvised`);
});
