import { test, expect } from '@playwright/test';

// Regression coverage for the /add/form route reached from the chat
// screen. When the user submits a chat prompt, the form mounts with
// pre-filled params (headliner, venueHint, dateHint, etc.). A non-
// empty venueQuery on mount drives VenueTypeahead's debounced effect
// to fire `onSearch(venueQuery)` immediately, which calls the parent's
// `runVenueSearch` and pushes the form through several state updates
// (loading: true, results: [...], loading: false). Each of those
// state updates re-renders the form, and the inline
// `<Stack.Screen options={{ presentation: 'modal' }}>` JSX recreates
// a fresh `options` object literal each render. The `useLayoutEffect`
// inside Expo Router's `Screen` keys on that `options` reference and
// re-fires `navigation.setOptions(options)` on every parent render —
// which (on iOS, where react-native-screens reacts to presentation
// changes) cascades into a remount loop that hits React's "Maximum
// update depth exceeded" bailout.
//
// react-native-screens-web ignores `presentation: 'modal'`, so the
// iOS-specific cascade doesn't reproduce here. This test instead
// asserts that the form mounts cleanly with chat-style params and
// doesn't churn the DOM (a render loop would show as a constant
// stream of mutations).

test.describe('mobile web — add form route', () => {
  test('mounts with chat params and settles without render churn', async ({ page }) => {
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
        window.localStorage.setItem('secureStore::showbook.auth.firstRunComplete', 'true');
      },
      { token, userJson: JSON.stringify(user) },
    );

    await page.route('**/api/trpc/**', async (route) => {
      const url = new URL(route.request().url());
      const procedurePath = url.pathname.split('/api/trpc/')[1] ?? '';
      const baseProcedure = procedurePath.split('?')[0] ?? '';
      const isBatch = url.searchParams.get('batch') === '1';
      const procedures = isBatch ? baseProcedure.split(',') : [baseProcedure];

      const results = procedures.map((proc) => {
        if (proc === 'venues.search') {
          return {
            result: {
              data: {
                json: [
                  {
                    id: 'venue-greek',
                    name: 'The Greek Theatre',
                    city: 'Berkeley',
                    stateRegion: 'CA',
                    country: 'US',
                  },
                ],
              },
            },
          };
        }
        return { result: { data: { json: null } } };
      });

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(isBatch ? results : results[0]),
      });
    });

    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    // Mirrors the params the chat screen sends after a successful
    // `enrichment.parseChat` round-trip.
    await page.goto(
      '/add/form?headliner=Phoebe%20Bridgers&venueHint=The%20Greek%20Theatre&dateHint=2026-08-15&kindHint=concert&freeText=Phoebe%20Bridgers%20at%20the%20Greek%208%2F15',
    );
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('New show', { exact: true }).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.locator('input[value="Phoebe Bridgers"]').first()).toBeVisible({
      timeout: 10_000,
    });

    await page.evaluate(() => {
      (window as unknown as { __mutationCount: number }).__mutationCount = 0;
      const observer = new MutationObserver((records) => {
        const w = window as unknown as { __mutationCount: number };
        w.__mutationCount += records.length;
      });
      observer.observe(document.body, { childList: true, subtree: true, attributes: true });
    });
    await page.waitForTimeout(3000);
    const mutationCount = await page.evaluate(
      () => (window as unknown as { __mutationCount: number }).__mutationCount,
    );
    expect(
      mutationCount,
      `DOM mutations in 3s after settle (suggests render loop if > 500): ${mutationCount}`,
    ).toBeLessThan(500);

    expect(pageErrors, `pageerror events: ${pageErrors.join('\n')}`).toEqual([]);
  });
});
