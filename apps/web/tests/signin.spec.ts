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
});
