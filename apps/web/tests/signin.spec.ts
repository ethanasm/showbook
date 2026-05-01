import { test, expect } from '@playwright/test';

test.describe('Sign-in page', () => {
  test('renders editorial layout and Google CTA', async ({ page }) => {
    await page.goto('/signin');

    // Hero copy
    await expect(page.getByText(/Personal Live-Show Tracker/i)).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/worth\s+remembering/i);
    await expect(page.getByText(/private logbook/i)).toBeVisible();

    // Kind chips
    for (const kind of ['Concerts', 'Theatre', 'Comedy', 'Festivals']) {
      await expect(page.getByText(kind, { exact: true })).toBeVisible();
    }

    // Google sign-in button
    const button = page.getByRole('button', { name: /sign in with google/i });
    await expect(button).toBeVisible();
    await expect(button.locator('img')).toHaveAttribute('src', /google-g\.svg/);

    await page.screenshot({
      path: 'test-results/screenshots/signin-desktop.png',
      fullPage: true,
    });
  });

  test('empty-state ticket cards are visible on desktop', async ({ page, viewport }) => {
    test.skip((viewport?.width ?? 0) < 900, 'Stage hidden under 900px');
    await page.goto('/signin');

    // Stacked sample show titles
    await expect(page.getByText(/Phoebe Bridgers/)).toBeVisible();
    await expect(page.getByText(/Hamlet/)).toBeVisible();
    await expect(page.getByText(/John Mulaney/)).toBeVisible();
    await expect(page.getByText(/Pitchfork Music Festival/)).toBeVisible();
  });

  test('Google logo SVG is served', async ({ page }) => {
    const res = await page.request.get('/google-g.svg');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toMatch(/svg/);
  });

  test('renders themed error banner for ?error=AccessDenied', async ({ page }) => {
    // NextAuth redirects allowlist-rejected users to /signin?error=AccessDenied.
    // The page must show a themed error and still expose the Google CTA.
    await page.goto('/signin?error=AccessDenied');

    // Scoped to the panel because Next.js injects its own route-announcer
    // with role="alert" at the document root.
    const banner = page.locator('.signin__error');
    await expect(banner).toBeVisible();
    await expect(banner).toHaveAttribute('role', 'alert');
    await expect(banner).toContainText(/allowlist/i);

    // Banner inherits theme tokens — sanity-check it sits on a non-default
    // background (the surface variable, not the browser-default white).
    const bg = await banner.evaluate(
      (el) => getComputedStyle(el).backgroundColor,
    );
    expect(bg).not.toBe('rgba(0, 0, 0, 0)');
    expect(bg).not.toBe('rgb(255, 255, 255)');

    // Sign-in button still works as a recovery affordance.
    await expect(
      page.getByRole('button', { name: /sign in with google/i }),
    ).toBeVisible();
  });

  test('renders generic themed error for unknown ?error= codes', async ({ page }) => {
    await page.goto('/signin?error=Verification');
    await expect(page.locator('.signin__error')).toContainText(/no longer valid/i);

    await page.goto('/signin?error=SomethingUnknown');
    await expect(page.locator('.signin__error')).toContainText(/something went wrong/i);
  });
});
