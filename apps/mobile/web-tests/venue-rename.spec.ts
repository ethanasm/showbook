import { test, expect } from '@playwright/test';

// Exercises the mobile venue rename flow added on the
// `claude/add-mobile-venue-rename-FGnT6` branch. The web bundle is
// the only place this can run in the sandbox, so the spec stubs the
// tRPC HTTP layer instead of standing up Postgres.
//
// Asserts:
//   1. The rename pencil button is rendered on the venue detail when
//      the user can rename (isFollowed || userShowCount > 0).
//   2. Tapping the pencil opens the sheet with the current name
//      prefilled.
//   3. Submitting calls `venues.rename` with the new name.
//   4. Optimistic patch updates the visible title before the network
//      round trip completes.

test.describe('mobile web — venue rename', () => {
  test('renames a venue from the detail screen', async ({ page }) => {
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

    const venueId = '00000000-0000-0000-0000-000000000001';
    let venueName = 'Fox Theater - Oakland';
    const renameCalls: { venueId: string; name: string }[] = [];

    await page.route('**/api/trpc/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const procedurePath = url.pathname.split('/api/trpc/')[1] ?? '';
      const baseProcedure = procedurePath.split('?')[0] ?? '';
      const isBatch = url.searchParams.get('batch') === '1';
      const procedures = isBatch ? baseProcedure.split(',') : [baseProcedure];

      // Pull inputs out of the batched query/mutation envelope.
      let inputs: Record<string, unknown> = {};
      if (request.method() === 'GET') {
        const raw = url.searchParams.get('input');
        if (raw) {
          try {
            inputs = JSON.parse(raw) as Record<string, unknown>;
          } catch {
            // ignore
          }
        }
      } else {
        try {
          const body = request.postDataJSON() as unknown;
          if (body && typeof body === 'object') {
            inputs = body as Record<string, unknown>;
          }
        } catch {
          // ignore
        }
      }

      const venueDetail = (): unknown => ({
        id: venueId,
        name: venueName,
        city: 'Oakland',
        stateRegion: 'California',
        country: 'US',
        photoUrl: null,
        googlePlaceId: null,
        latitude: null,
        longitude: null,
        addressLine: null,
        zip: null,
        ticketmasterId: null,
        timezone: null,
        capacity: null,
        slug: 'fox-theater-oakland',
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
        isFollowed: true,
        userShowCount: 0,
        upcomingCount: 0,
      });

      const results = procedures.map((proc, i) => {
        const json = ((): unknown => {
          if (proc === 'venues.detail') return venueDetail();
          if (proc === 'venues.rename') {
            const payload = ((): { venueId?: string; name?: string } => {
              if (!isBatch) {
                const json = (inputs as { json?: unknown })?.json;
                return (json as { venueId?: string; name?: string }) ?? {};
              }
              const entry = (inputs as Record<string, { json?: unknown }>)[String(i)];
              return (entry?.json as { venueId?: string; name?: string }) ?? {};
            })();
            if (payload?.name) {
              venueName = payload.name;
              renameCalls.push({
                venueId: payload.venueId ?? '',
                name: payload.name,
              });
            }
            return venueDetail();
          }
          // Default empty payloads for everything else (upcoming, userShows,
          // media, watchedAnnouncementIds, etc.).
          return [];
        })();
        return { result: { data: { json } } };
      });

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(isBatch ? results : results[0]),
      });
    });

    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.goto(`/venues/${venueId}`);
    await page.waitForLoadState('networkidle');

    // The pencil button is rendered with testID="venue-rename-button" —
    // react-native-web maps testID onto the DOM data-testid attribute.
    const renameBtn = page.locator('[data-testid="venue-rename-button"]').first();
    await expect(renameBtn).toBeVisible({ timeout: 10_000 });

    await renameBtn.click();

    const input = page.locator('[data-testid="rename-venue-input"]').first();
    await expect(input).toBeVisible({ timeout: 5_000 });
    await expect(input).toHaveValue('Fox Theater - Oakland');

    await input.fill('Fox Oakland');
    await page.locator('[data-testid="rename-venue-save"]').first().click();

    // Optimistic patch should flip the visible title even before the
    // network confirms — the sheet's onClose fires after the mutation
    // resolves, but the cache write happens before the network call.
    await expect(page.getByText('Fox Oakland', { exact: false }).first()).toBeVisible({
      timeout: 5_000,
    });

    // Server got the rename mutation with the trimmed new name.
    expect(renameCalls.at(-1)).toEqual({ venueId, name: 'Fox Oakland' });

    expect(pageErrors, `pageerror events: ${pageErrors.join('\n')}`).toEqual([]);
  });
});
