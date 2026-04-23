import { test, expect } from '@playwright/test';

test.describe('Smoke tests', () => {
  test('app loads', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Showbook/);
    await page.screenshot({
      path: 'test-results/screenshots/smoke-app-loads.png',
      fullPage: true
    });
  });
});
