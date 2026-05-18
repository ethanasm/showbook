import { test, expect } from '@playwright/test';

// Regression coverage for the edit-show route. The screen presents
// itself as a `Stack.Screen options={{ presentation: 'modal' }}`,
// and that declaration MUST appear on every render branch (loading
// + loaded), not just the loaded one. If the loading branch omits
// it, the route boots as a default push and then flips to modal
// once the shows.detail query resolves — react-native-screens reacts
// by unmounting the screen out of the push container and re-mounting
// it inside the modal container, which resets local state, refires
// the effect that loads `initial`/`values`, and loops forever. That
// surfaces on iOS as an infinite "routing loop" the moment the user
// taps Edit on a show.
//
// react-native-screens-web ignores `presentation: 'modal'`, so the
// loop doesn't reproduce in this bundle. This test instead asserts
// the structural outcome the fix guarantees: the edit screen mounts
// once, the loading skeleton settles into the form without
// re-entering the loading state, and the page stays put afterward.

test.describe('mobile web — edit show route', () => {
  test('navigates to /show/:id/edit and settles without re-mount thrash', async ({ page }) => {
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

    // Stub tRPC HTTP. The mobile client uses httpBatchLink + the
    // superjson transformer, so responses have to be wrapped in the
    // `{ result: { data: { json } } }` envelope superjson decodes.
    const showDetail = {
      id: 'show-1',
      kind: 'concert',
      state: 'past',
      date: '2025-01-15',
      seat: 'A1',
      pricePaid: '50.00',
      ticketCount: 1,
      tourName: null,
      productionName: null,
      notes: null,
      venue: {
        id: 'venue-1',
        name: 'Test Venue',
        city: 'Test City',
        stateRegion: 'TS',
      },
      showPerformers: [
        {
          role: 'headliner',
          sortOrder: 0,
          characterName: null,
          performer: { id: 'performer-1', name: 'Test Artist' },
        },
      ],
      setlists: null,
    };

    await page.route('**/api/trpc/**', async (route) => {
      const url = new URL(route.request().url());
      const procedurePath = url.pathname.split('/api/trpc/')[1] ?? '';
      const baseProcedure = procedurePath.split('?')[0] ?? '';
      const isBatch = url.searchParams.get('batch') === '1';
      const procedures = isBatch ? baseProcedure.split(',') : [baseProcedure];

      const results = procedures.map((proc) => {
        if (proc === 'shows.detail') {
          return { result: { data: { json: showDetail } } };
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

    await page.goto('/show/show-1/edit');
    await page.waitForLoadState('networkidle');

    // The edit screen must reach its loaded state (form fields are
    // populated). If the Stack.Screen branch toggle was re-mounting
    // the screen, the loaded form would never settle.
    await expect(page.getByText('Edit show', { exact: true }).first()).toBeVisible({
      timeout: 10_000,
    });
    // The form input below "HEADLINER" prefills with the show's
    // headliner name once the detail query resolves. Match by the
    // input's value attribute rather than the (web-only) getByDisplayValue.
    await expect(page.locator('input[value="Test Artist"]').first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.locator('input[value="2025-01-15"]').first()).toBeVisible();

    // Observe DOM mutations for 3 seconds after the form has settled.
    // A re-mount loop would show as a constant stream of mutations.
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
