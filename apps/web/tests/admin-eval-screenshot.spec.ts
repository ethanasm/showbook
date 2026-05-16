/**
 * One-off capture for the Phase-4 /admin/eval page so the PR description
 * carries visual review material. Skipped unless `CAPTURE_ADMIN_EVAL=1`
 * is set so this doesn't burden the regular e2e run.
 *
 * Data backing the screenshot is seeded by
 * `scripts/seed-eval-screenshot-data.mjs` (run before this spec).
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

test.skip(
  process.env.CAPTURE_ADMIN_EVAL !== '1',
  'Set CAPTURE_ADMIN_EVAL=1 to capture /admin/eval screenshots',
);

test('capture /admin/eval — populated', async ({ page }) => {
  test.setTimeout(180_000);
  await loginAsWorker(page);
  await page.goto('/admin/eval');
  await expect(page.getByRole('heading', { name: /Setlist eval harness/i })).toBeVisible();
  await expect(page.getByText('Brier (mean)')).toBeVisible();
  await page.addStyleTag({ content: HIDE_DEV_INDICATOR });
  await takeScreenshot(page, 'pr-desktop-admin-eval-populated');
});

test('capture /admin/eval — row expanded', async ({ page }) => {
  test.setTimeout(180_000);
  await loginAsWorker(page);
  await page.goto('/admin/eval');
  await expect(page.getByRole('heading', { name: /Setlist eval harness/i })).toBeVisible();
  await expect(page.getByText('Most recent show evaluations')).toBeVisible();
  // Open the first row's per-show drill-down so the predicted-vs-played
  // grid is captured alongside the metrics.
  const firstRow = page
    .getByRole('button')
    .filter({ hasText: 'Backtest Fixture' })
    .first();
  await firstRow.click();
  await expect(page.getByText('Predicted (top 15)')).toBeVisible();
  await page.addStyleTag({ content: HIDE_DEV_INDICATOR });
  await takeScreenshot(page, 'pr-desktop-admin-eval-row-expanded');
});
