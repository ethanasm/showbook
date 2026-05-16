import { test, expect } from '@playwright/test';

// Smoke coverage for the headless web verification loop. These tests
// don't try to be a full e2e suite — the real e2e gate is still
// Android + Maestro on the self-hosted runner. They exist so we can
// catch the loudest regressions (app fails to mount, sign-in screen
// missing, signed-in app fails to render the tab bar) before pushing.

test.describe('mobile web smoke', () => {
  test('boots to the sign-in screen', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/');
    // The auth gate's "Sign in with Google" button is the canonical
    // signed-out anchor used by the Maestro flows too.
    await expect(page.getByText('Sign in with Google')).toBeVisible({
      timeout: 15_000,
    });
    expect(errors, `pageerror events: ${errors.join('\n')}`).toEqual([]);
  });

  test('renders the tab shell when a session is pre-seeded', async ({ page }) => {
    const token = 'web-shim-test-token';
    const user = {
      id: 'web-shim-user',
      email: 'web-shim@showbook.dev',
      name: 'Web Shim',
      image: null,
    };

    // The expo-secure-store shim is localStorage-backed (see
    // web-shims/expo-secure-store.js), so seeding the keys here is the
    // web equivalent of Maestro's debug-deeplink seed step.
    await page.addInitScript(
      ({ token, userJson }) => {
        window.localStorage.setItem('secureStore::showbook.auth.token', token);
        window.localStorage.setItem('secureStore::showbook.auth.user', userJson);
        window.localStorage.setItem('secureStore::showbook.auth.firstRunComplete', 'true');
      },
      { token, userJson: JSON.stringify(user) },
    );

    await page.goto('/');

    // The signed-in shell renders the 5-tab bar. Scope to the tablist
    // and take `.first()` since some labels also appear as per-screen
    // header text (e.g. the "Me" header on the Me tab). The presence
    // of the tablist + tabs is enough to confirm the app routed past
    // the auth gate.
    const tabs = page.getByRole('tablist').first();
    await expect(tabs).toBeVisible({ timeout: 15_000 });
    await expect(tabs.getByRole('tab', { name: 'Home' }).first()).toBeVisible();
    await expect(tabs.getByRole('tab', { name: 'Shows' }).first()).toBeVisible();
    await expect(tabs.getByRole('tab', { name: 'Map' }).first()).toBeVisible();
    await expect(tabs.getByRole('tab', { name: 'Me' }).first()).toBeVisible();

    // And the sign-in screen should be gone.
    await expect(page.getByText('Sign in with Google')).toBeHidden();
  });
});
