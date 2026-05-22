import { test, expect, type Page, type Route } from '@playwright/test';

// Coverage for the operator-only ADMIN section on the Me screen
// (components/AdminSection.tsx). The section is gated by the
// `admin.amIAdmin` tRPC query, so these tests stub the tRPC batch
// endpoint — `isAdmin: true` makes the section render, `false` keeps
// it hidden. The eight rows + the confirm/cancel sheet are the thing
// under test; the real upstream jobs are exercised by the admin-router
// integration tests on the web app.

const TOKEN = 'web-shim-test-token';
const USER = {
  id: 'web-shim-admin',
  email: 'admin@showbook.dev',
  name: 'Admin User',
  image: null,
};

async function seedSession(page: Page): Promise<void> {
  await page.addInitScript(
    ({ token, userJson }) => {
      window.localStorage.setItem('secureStore::showbook.auth.token', token);
      window.localStorage.setItem('secureStore::showbook.auth.user', userJson);
      window.localStorage.setItem(
        'secureStore::showbook.auth.firstRunComplete',
        'true',
      );
    },
    { token: TOKEN, userJson: JSON.stringify(USER) },
  );
}

/**
 * Stub the superjson-shaped tRPC batch endpoint. `admin.amIAdmin`
 * decides whether the section renders; `admin.backfillVenueCoordinates`
 * is the one mutation a test confirms. Everything else resolves to null
 * (the Me screen tolerates empty prefs / integration status).
 */
async function mockTrpc(
  page: Page,
  opts: { isAdmin: boolean },
): Promise<void> {
  await page.route('**/api/trpc/**', async (route: Route) => {
    const url = new URL(route.request().url());
    const procedurePath = url.pathname.split('/api/trpc/')[1] ?? '';
    const baseProcedure = procedurePath.split('?')[0] ?? '';
    const isBatch = url.searchParams.get('batch') === '1';
    const procedures = isBatch ? baseProcedure.split(',') : [baseProcedure];

    const results = procedures.map((proc) => {
      if (proc === 'admin.amIAdmin') {
        return { result: { data: { json: { isAdmin: opts.isAdmin } } } };
      }
      if (proc === 'admin.backfillVenueCoordinates') {
        return {
          result: { data: { json: { total: 5, geocoded: 4, failed: 1 } } },
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
}

test.describe('mobile web — Me admin section', () => {
  test('an admin sees the ADMIN section and can open + confirm a job', async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await seedSession(page);
    await mockTrpc(page, { isAdmin: true });
    await page.goto('/me');
    await page.waitForLoadState('networkidle');

    // Section header + a sampling of the eight job rows.
    await expect(page.getByText('ADMIN', { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.getByTestId('admin-row-venue-coordinates'),
    ).toBeVisible();
    await expect(page.getByTestId('admin-row-prune-orphans')).toBeVisible();
    await expect(page.getByTestId('admin-row-corpus-fill')).toBeVisible();

    // Tapping a row opens the confirmation sheet: description + the
    // action-specific Confirm + a Cancel.
    await page.getByTestId('admin-row-venue-coordinates').click();
    await expect(page.getByText(/Geocodes every venue/)).toBeVisible();
    await expect(page.getByTestId('admin-confirm')).toBeVisible();
    await expect(page.getByTestId('admin-cancel')).toBeVisible();

    // Confirm runs the job and surfaces the result summary in a toast,
    // then closes the sheet.
    await page.getByTestId('admin-confirm').click();
    await expect(page.getByText(/Geocoded 4 .* 5 total/)).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText(/Geocodes every venue/)).toBeHidden();

    // The performer action sheet carries a labelled text input.
    await page.getByTestId('admin-row-corpus-fill').click();
    await expect(page.getByTestId('admin-performer-input')).toBeVisible();
    await page.getByTestId('admin-cancel').click();
    await expect(page.getByTestId('admin-performer-input')).toBeHidden();

    // The destructive action sheet carries an extra warning note.
    await page.getByTestId('admin-row-prune-orphans').click();
    await expect(page.getByText(/permanently deletes/)).toBeVisible();

    expect(
      pageErrors,
      `pageerror events: ${pageErrors.join('\n')}`,
    ).toEqual([]);
  });

  test('a non-admin does not see the ADMIN section', async ({ page }) => {
    await seedSession(page);
    await mockTrpc(page, { isAdmin: false });
    await page.goto('/me');
    await page.waitForLoadState('networkidle');

    // The Me screen rendered — "Sign out" is the ACCOUNT row that sits
    // directly above where the admin section would be.
    await expect(page.getByText('Sign out')).toBeVisible({ timeout: 15_000 });

    // ...but the operator section is absent for a non-admin.
    await expect(page.getByText('ADMIN', { exact: true })).toHaveCount(0);
    await expect(
      page.getByTestId('admin-row-venue-coordinates'),
    ).toHaveCount(0);
  });
});
