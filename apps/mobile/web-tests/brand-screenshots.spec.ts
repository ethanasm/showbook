/**
 * Visual capture for the new gold-ticket BrandMark across the two
 * top-level mobile surfaces — the sign-in screen (cold open) and the
 * Home tab (after a session is pre-seeded into localStorage). Outputs
 * are PNGs written next to the test under `brand-screenshots/`; this
 * spec is opt-in via `RUN_BRAND_SCREENSHOTS=1` because it's a manual
 * capture step rather than a regression assertion.
 */

import path from 'node:path';
import { test, expect } from '@playwright/test';

const RUN = process.env.RUN_BRAND_SCREENSHOTS === '1';
test.describe.configure({ mode: 'serial' });

const OUT_DIR = path.join(__dirname, 'brand-screenshots');

// Capture both color schemes — dark is Showbook's primary surface but the
// app supports light too, and the brand mark needs to read on both.
const SCHEMES = ['light', 'dark'] as const;
type Scheme = (typeof SCHEMES)[number];

for (const scheme of SCHEMES) {
  test.describe(`brand placement (${scheme})`, () => {
    test.skip(!RUN, 'set RUN_BRAND_SCREENSHOTS=1 to capture');
    test.use({ colorScheme: scheme as Scheme });

    test(`signin (${scheme})`, async ({ page }) => {
      await page.goto('/');
      await expect(page.getByText('Sign in with Google')).toBeVisible({
        timeout: 15_000,
      });
      // Quick wait so the StackedCards animation settles before capture.
      await page.waitForTimeout(400);
      await page.screenshot({
        path: path.join(OUT_DIR, `mobile-signin-${scheme}.png`),
        fullPage: true,
      });
    });

    test(`home (${scheme})`, async ({ page }) => {
      const token = 'web-shim-test-token';
      const user = {
        id: 'web-shim-user',
        email: 'web-shim@showbook.dev',
        name: 'Web Shim',
        image: null,
      };
      await page.addInitScript(
        ({ token, userJson }) => {
          window.localStorage.setItem('secureStore::showbook.auth.token', token);
          window.localStorage.setItem('secureStore::showbook.auth.user', userJson);
          window.localStorage.setItem(
            'secureStore::showbook.auth.firstRunComplete',
            'true',
          );
        },
        { token, userJson: JSON.stringify(user) },
      );

      await page.goto('/');
      // Wait for the tab shell to mount — the brand header is the first
      // thing on the Home tab. Use the tablist rather than the "showbook"
      // wordmark as the readiness anchor so the same spec can capture
      // pre-PR baselines (where the wordmark didn't exist yet).
      await expect(page.getByRole('tablist').first()).toBeVisible({
        timeout: 15_000,
      });
      await page.waitForTimeout(400);
      await page.screenshot({
        path: path.join(OUT_DIR, `mobile-home-${scheme}.png`),
        fullPage: false,
      });
    });
  });
}
