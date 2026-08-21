/**
 * Ad-hoc visual capture for the Archivo typography pass. Not part of the
 * suite's assertions — it walks the five screens the design handoff mocks
 * (Home, Show detail, Discover, Upcoming, Venues) in light theme and writes a
 * PNG per screen so the result can be diffed against the mocks by eye.
 *
 * Opt-in via `RUN_TYPO_SCREENSHOTS=1`.
 */

import { expect, test } from '@playwright/test';
import { loginAndSeedAsWorker } from './helpers/auth';

const RUN = process.env.RUN_TYPO_SCREENSHOTS === '1';
const OUT = process.env.TYPO_OUT ?? 'test-results/typography';
const THEME = process.env.TYPO_THEME ?? 'dark';

test.describe('typography capture', () => {
  test.skip(!RUN, 'set RUN_TYPO_SCREENSHOTS=1');
  test.use({ viewport: { width: 1500, height: 760 } });

  test('captures the five mocked screens', async ({ page }) => {
    test.setTimeout(180_000);
    await loginAndSeedAsWorker(page);
    // Set the theme through Preferences, not localStorage: `PrefsServerSync`
    // pushes the server-stored preference into `setTheme` on every mount, so
    // a localStorage write is overwritten on the next navigation.
    await page.emulateMedia({
      colorScheme: THEME === 'light' ? 'light' : 'dark',
    });
    await page.goto('/preferences');
    await page.waitForLoadState('networkidle');
    const themeOption = THEME === 'light' ? 'Light' : 'Dark';
    await page
      .getByRole('main')
      .getByRole('button', { name: themeOption, exact: true })
      .first()
      .click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', THEME, {
      timeout: 10_000,
    });

    const shots: [string, string][] = [
      ['home', '/home'],
      ['discover', '/discover'],
      ['upcoming', '/upcoming'],
      ['venues', '/venues'],
      ['logbook', '/logbook'],
    ];

    for (const [name, path] of shots) {
      await page.goto(path);
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `${OUT}/${name}.png` });
    }

    // Show detail — first row in the logbook.
    await page.goto('/logbook');
    await page.waitForLoadState('networkidle').catch(() => {});
    const row = page.getByRole('main').locator('[data-testid="show-row"], .show-row').first();
    if (await row.count()) {
      await row.click();
      await page.waitForTimeout(2000);
      await page.screenshot({ path: `${OUT}/show-detail.png` });
    }
  });
});
