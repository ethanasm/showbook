import { test, expect } from '@playwright/test';

test.describe('Multi-user isolation', () => {
  test('a second user does not see the first user\'s shows', async ({ browser }) => {
    const aliceCtx = await browser.newContext({ ignoreHTTPSErrors: true });
    const alice = await aliceCtx.newPage();

    await alice.goto('/api/test/login');
    await alice.waitForURL('**/home');
    await alice.goto('/api/test/seed');

    await alice.goto('/home');
    await expect(alice.getByText('Radiohead').first()).toBeVisible();

    await aliceCtx.close();

    const bobCtx = await browser.newContext({ ignoreHTTPSErrors: true });
    const bob = await bobCtx.newPage();

    await bob.goto('/api/test/login?email=bob@showbook.dev&name=Bob');
    await bob.waitForURL('**/home');

    // Home now shows the empty state when the user has no shows.
    await expect(bob.getByText('No shows yet', { exact: false })).toBeVisible();
    await expect(bob.getByText('Radiohead')).toHaveCount(0);

    await bob.screenshot({
      path: 'test-results/screenshots/multi-user-bob-empty.png',
      fullPage: true,
    });

    await bobCtx.close();

    const aliceAgain = await browser.newContext({ ignoreHTTPSErrors: true });
    const alicePage = await aliceAgain.newPage();
    await alicePage.goto('/api/test/login');
    await alicePage.waitForURL('**/home');
    await expect(alicePage.getByText('Radiohead').first()).toBeVisible();
    await aliceAgain.close();
  });
});
