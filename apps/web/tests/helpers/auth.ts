import { Page } from '@playwright/test';

export async function loginAsTestUser(page: Page) {
  // For testing, we'll use a test endpoint that creates a session
  // This will be implemented when auth is set up (T07)
  await page.goto('/api/test/login');
  await page.waitForURL('/home', { timeout: 5000 }).catch(() => {
    // Auth not yet set up, continue anyway
  });
}
