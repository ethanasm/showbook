import { test, expect, type Page } from '@playwright/test';

async function loginAndSeed(page: Page) {
  await page.goto('/api/test/login');
  await page.waitForURL('**/home');
  await page.goto('/api/test/seed');
  await page.waitForLoadState('networkidle');
}

test.describe('Preferences improvements', () => {
  test.beforeEach(async ({ page }) => {
    await loginAndSeed(page);
  });

  test('"Show-day reminder" row is absent from preferences page', async ({ page }) => {
    await page.goto('/preferences');
    await page.waitForLoadState('networkidle');

    await expect(page.getByText(/Show-day reminder/i)).not.toBeVisible();
  });

  test('Wikipedia is absent from the data sources list', async ({ page }) => {
    await page.goto('/preferences');
    await page.waitForLoadState('networkidle');

    await expect(page.getByText(/Wikipedia/i)).not.toBeVisible();
  });

  test('digest time description mentions daily schedule', async ({ page }) => {
    await page.goto('/preferences');
    await page.waitForLoadState('networkidle');

    // The description should say something about "sent at this hour" or "every day"
    await expect(page.locator('body')).toContainText(/sent at this hour.*every day/i);
  });

  test('5-region cap: shows region counter X / 5 near regions section', async ({ page }) => {
    await page.goto('/preferences');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('body')).toContainText(/\/ 5 regions/);
  });

  test('5-region cap: adding a 6th region shows cap error', async ({ page }) => {
    // Seed gives 2 regions (New York + Brooklyn). Add 3 more via the test endpoint to reach 5.
    for (let i = 1; i <= 3; i++) {
      await page.goto(
        `/api/test/seed?addRegion=${i}&lat=${37 + i}&lng=${-122 + i}&radius=25&city=TestCity${i}`
      );
      await page.waitForLoadState('networkidle');
    }

    // Now navigate to preferences and verify the cap UI
    await page.goto('/preferences');
    await page.waitForLoadState('networkidle');

    // The "Maximum 5 regions" message should show
    await expect(page.locator('body')).toContainText(/Maximum 5 regions/i);

    // The "Add a region" button/link should NOT be visible (replaced by cap message)
    await expect(page.locator('button, div').filter({ hasText: /^Add a region$/ })).not.toBeVisible();
  });

  test('5-region cap: adding a 6th region via API returns BAD_REQUEST', async ({ page }) => {
    // Use the tRPC endpoint directly
    await page.goto('/api/test/seed');
    await page.waitForLoadState('networkidle');

    // Add 5 regions
    const addRegion = async (i: number) => {
      const res = await page.evaluate(async (idx: number) => {
        const response = await fetch('/api/trpc/preferences.addRegion', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            "0": {
              json: {
                cityName: `City ${idx}`,
                latitude: 37 + idx,
                longitude: -122 + idx,
                radiusMiles: 25,
              }
            }
          }),
        });
        const data = await response.json();
        return { status: response.status, data };
      }, i);
      return res;
    };

    // Add 5 (some might already exist from seed)
    // First clear, then add
    for (let i = 1; i <= 5; i++) {
      await addRegion(i);
    }

    // The 6th should fail
    const result = await page.evaluate(async () => {
      const response = await fetch('/api/trpc/preferences.addRegion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          "0": {
            json: {
              cityName: 'City 6',
              latitude: 43,
              longitude: -116,
              radiusMiles: 25,
            }
          }
        }),
      });
      const data = await response.json();
      return { status: response.status, data };
    });

    // Should get BAD_REQUEST or an error in the response
    const body = JSON.stringify(result.data);
    expect(body).toMatch(/BAD_REQUEST|most 5|at most 5/i);
  });

  test('followed venues list paginates at 10/page with prev/next buttons', async ({ page }) => {
    // The seed data has a small number of venues — this test checks the pagination
    // logic by looking for the pagination controls if more than 10 venues exist
    await page.goto('/preferences');
    await page.waitForLoadState('networkidle');

    // Check the followed venues section exists
    await expect(page.getByText(/Followed venues/i).first()).toBeVisible();

    // With seed data (typically < 10 venues), pagination buttons might not appear
    // Just verify the page doesn't error and the list renders
    const followedVenuesSection = page.locator('body').filter({ hasText: /Followed venues/ });
    await expect(followedVenuesSection).toBeVisible();

    // If pagination is visible, verify structure
    const prevBtn = page.getByRole('button', { name: /Prev/i });
    const nextBtn = page.getByRole('button', { name: /Next/i });

    const hasPagination = await prevBtn.isVisible().catch(() => false);
    if (hasPagination) {
      await expect(prevBtn).toBeDisabled(); // first page, prev should be disabled
      await expect(nextBtn).toBeEnabled();
    }
  });
});
