import { test, expect, type Page } from '@playwright/test';

// Verifies the post-review fixes:
//   - Fix #1: Theme hydrates from server prefs on a fresh browser context
//   - Fix #2: Digest time picker only allows whole hours and saves HH:00
//   - Fix #5: AddRegionForm has a manual coords fallback + error surface
//   - Fix #7: VenueFollowModal surfaces Places search errors
//   - Fix #8: Account section shows name + sign-out; sidebar shows real user
//   - compactMode actually changes list-page row density

async function login(page: Page, email = 'test@showbook.dev', name = 'Test User') {
  await page.goto(`/api/test/login?email=${encodeURIComponent(email)}&name=${encodeURIComponent(name)}`);
  await page.waitForURL('**/home');
}

async function gotoPrefs(page: Page) {
  await page.goto('/preferences');
  await expect(page.getByText('Account', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Followed venues', { exact: true })).toBeVisible({ timeout: 15_000 });
}

test.describe('Preferences fixes', () => {
  test.describe.configure({ mode: 'serial' });

  test('account section shows name and sign-out button', async ({ page }) => {
    await login(page);
    await gotoPrefs(page);
    const main = page.getByRole('main');
    await expect(main.getByText('test@showbook.dev')).toBeVisible();
    await expect(main.getByText('Test User')).toBeVisible();
    await expect(main.getByRole('button', { name: /Sign out/i })).toBeVisible();
  });

  test('sidebar shows the session user, not a placeholder', async ({ page }) => {
    await login(page);
    await gotoPrefs(page);
    const sidebarContent = await page.locator('.sidebar__user').innerText();
    console.log('SIDEBAR_USER', sidebarContent);
    expect(sidebarContent).toContain('Test User');
    expect(sidebarContent).not.toContain('Ethan Smith');
  });

  // The configurable digest time was removed when the daily digest was
  // consolidated to fire at 08:00 ET (commit 058b410). The picker is
  // gone; nothing to assert here.

  test('AddRegionForm has manual coords fallback', async ({ page }) => {
    await login(page);
    await gotoPrefs(page);
    await page.getByText('Add a region').first().click();
    const manualToggle = page.getByRole('button', { name: /Enter coordinates manually/i });
    await expect(manualToggle).toBeVisible();
    await manualToggle.click();
    const lat = page.locator('input[placeholder="36.1627"]');
    const lng = page.locator('input[placeholder="-86.7816"]');
    await expect(lat).toBeVisible();
    await expect(lng).toBeVisible();
    await page.locator('input[placeholder*="Nashville"]').fill('Nashville');
    await lat.fill('36.1627');
    await lng.fill('-86.7816');
    const addBtn = page.getByRole('button', { name: /Add Region/i });
    await addBtn.click();
    await page.waitForTimeout(1500);
    await expect(page.getByText('Nashville', { exact: false }).first()).toBeVisible();
  });

  test('AddRegionForm surfaces search errors', async ({ page }) => {
    await login(page);
    await gotoPrefs(page);
    await page.getByText('Add a region').first().click();
    await page.locator('input[placeholder*="Nashville"]').fill('Boston');
    await page.waitForTimeout(2000);
    const bodyText = await page.locator('body').innerText();
    // The dropdown must reach a terminal state — never hang on
    // "Searching…". Real results, the error banner, or "No matches"
    // (when the Places API key isn't configured) all qualify.
    const hasError = bodyText.includes('Search unavailable') || bodyText.includes('unavailable right now');
    const hasNoMatches = bodyText.includes('No matches');
    const hasResults = await page.locator('button').filter({ hasText: /Boston/ }).count();
    console.log('SEARCH_RESPONSE', { hasError, hasNoMatches, hasResults });
    expect(hasError || hasNoMatches || hasResults > 0).toBeTruthy();
  });

  test('VenueFollowModal reaches a terminal state', async ({ page }) => {
    await login(page);
    await gotoPrefs(page);
    await page.getByText('Follow a venue').first().click();
    await page.locator('input[placeholder*="Search venues"]').fill('Madison Square Garden');
    await page.waitForTimeout(2500);
    const bodyText = await page.locator('body').innerText();
    // The dropdown must reach a terminal state — error banner, real
    // results, or "No venues found" when no API key is configured.
    // Never a permanent "Searching…" spinner.
    const hasError = bodyText.includes('Google Places search is unavailable');
    const hasNoVenuesMsg = bodyText.includes('No venues found');
    const hasResults = await page.locator('button').filter({ hasText: /Madison Square Garden/i }).count();
    const stillSearching = bodyText.includes('Searching…') || bodyText.includes('Searching...');
    console.log('FOLLOW_MODAL_RESPONSE', { hasError, hasNoVenuesMsg, hasResults, stillSearching });
    expect(stillSearching).toBeFalsy();
    expect(hasError || hasNoVenuesMsg || hasResults > 0).toBeTruthy();
  });

  test('compactMode reduces row padding on shows page', async ({ page }) => {
    await login(page);
    await page.goto('/api/test/seed');
    await page.waitForTimeout(1500);

    // Force compactMode to a known starting value (off).
    await gotoPrefs(page);
    const compactRow = page.locator('div').filter({ hasText: /^Compact mode/ }).first();
    const toggle = compactRow.getByRole('switch');
    if ((await toggle.getAttribute('aria-checked')) === 'true') {
      await toggle.click();
      await page.waitForTimeout(600);
    }

    await page.goto('/shows');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.show-row').first()).toBeVisible({ timeout: 10_000 });
    const looseHeight = (await page.locator('.show-row').first().boundingBox())!.height;
    const looseAttr = await page.locator('html').getAttribute('data-compact');
    console.log('LOOSE', looseHeight, 'data-compact', looseAttr);

    // Turn compact mode ON.
    await gotoPrefs(page);
    const compactRow2 = page.locator('div').filter({ hasText: /^Compact mode/ }).first();
    await compactRow2.getByRole('switch').click();
    await page.waitForTimeout(800);

    await page.goto('/shows');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.show-row').first()).toBeVisible({ timeout: 10_000 });
    const compactHeight = (await page.locator('.show-row').first().boundingBox())!.height;
    const compactAttr = await page.locator('html').getAttribute('data-compact');
    console.log('COMPACT', compactHeight, 'data-compact', compactAttr);

    expect(compactAttr).toBe('true');
    expect(compactHeight).toBeLessThan(looseHeight);

    await page.screenshot({
      path: 'test-results/screenshots/shows-compact.png',
      fullPage: true,
    });

    // Reset to off so other tests start clean.
    await gotoPrefs(page);
    const compactRow3 = page.locator('div').filter({ hasText: /^Compact mode/ }).first();
    if ((await compactRow3.getByRole('switch').getAttribute('aria-checked')) === 'true') {
      await compactRow3.getByRole('switch').click();
      await page.waitForTimeout(500);
    }
  });

  test('theme hydrates from server in a fresh context', async ({ browser }) => {
    // Set theme to "light" in context A.
    const ctxA = await browser.newContext({ ignoreHTTPSErrors: true });
    const a = await ctxA.newPage();
    await login(a);
    await gotoPrefs(a);
    await a.getByRole('button', { name: 'Light', exact: true }).click();
    await a.waitForTimeout(800);
    await ctxA.close();

    // Open a brand new context (clears localStorage) and log in as same user.
    const ctxB = await browser.newContext({ ignoreHTTPSErrors: true });
    const b = await ctxB.newPage();
    await login(b);
    await b.waitForTimeout(2000);
    const dataTheme = await b.locator('html').getAttribute('data-theme');
    console.log('FRESH_CONTEXT_DATA_THEME', dataTheme);
    expect(dataTheme).toBe('light');
    await ctxB.close();
  });
});
