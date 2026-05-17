import { test, expect } from '@playwright/test';

// Offline-mode smoke for the headless web verification loop.
//
// The native cache layer (expo-sqlite) is shimmed to an empty in-memory
// store on web (see apps/mobile/web-shims/expo-sqlite.js), so we can't
// pre-seed the persisted query cache and expect the show-detail screens
// to render from it on cold-start. What this loop *can* assert:
//   - The OfflineBanner shows when the network drops.
//   - Discover / Search / the Spotify integration screen render the
//     `OfflineEmptyState` placeholder instead of spinning forever.
//
// Warm-up + the per-screen cache hydration path is covered by
// `lib/__tests__/cache/warmup.test.ts` + `warmup.integration.test.ts`,
// which exercise the persister against an in-memory storage and assert
// every canonical key lands. Real native cache behaviour ships through
// the Android Maestro flow.
//
// Networking note: Playwright's `context.setOffline(true)` flips
// `navigator.onLine` to false but does NOT fire the `change` events that
// `@react-native-community/netinfo`'s web build subscribes to (via
// `navigator.connection` or `window.online`/`offline`). To exercise the
// transition deterministically, the helper below dispatches the events
// directly. This is the headless-web equivalent of Maestro's
// `EXPO_PUBLIC_FORCE_OFFLINE` build-time flag.

async function flipNetworkOffline(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', {
      value: false,
      configurable: true,
      writable: true,
    });
    const connection = (
      navigator as Navigator & { connection?: EventTarget }
    ).connection;
    if (connection) connection.dispatchEvent(new Event('change'));
    window.dispatchEvent(new Event('offline'));
  });
}

const TEST_SESSION = {
  token: 'web-shim-offline-token',
  user: {
    id: 'web-shim-offline-user',
    email: 'offline@showbook.dev',
    name: 'Offline Shim',
    image: null,
  },
};

async function signInViaShim(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript(
    ({ token, userJson }) => {
      window.localStorage.setItem('secureStore::showbook.auth.token', token);
      window.localStorage.setItem('secureStore::showbook.auth.user', userJson);
      window.localStorage.setItem(
        'secureStore::showbook.auth.firstRunComplete',
        'true',
      );
    },
    { token: TEST_SESSION.token, userJson: JSON.stringify(TEST_SESSION.user) },
  );
}

test.describe('offline mode', () => {
  test('shows offline banner when network drops on Home', async ({ page }) => {
    await signInViaShim(page);
    await page.goto('/');
    await expect(page.getByRole('tablist').first()).toBeVisible({ timeout: 15_000 });
    await flipNetworkOffline(page);
    // OfflineBanner is mounted globally by OfflineSyncProvider — once
    // `useNetwork().online` flips to false, the FeedbackProvider banner
    // queue surfaces "You're offline. Changes will sync when you're back."
    await expect(page.getByText(/You're offline/i).first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test('Search renders OfflineEmptyState when offline', async ({ page }) => {
    await signInViaShim(page);
    await page.goto('/search');
    await flipNetworkOffline(page);
    await expect(page.getByText(/Search is offline-only/i)).toBeVisible({
      timeout: 10_000,
    });
  });

  test('Discover renders OfflineEmptyState when offline with no cached items', async ({
    page,
  }) => {
    await signInViaShim(page);
    await page.goto('/discover');
    await flipNetworkOffline(page);
    await expect(page.getByText(/Discover needs a connection/i)).toBeVisible({
      timeout: 10_000,
    });
  });

  test('Spotify integration screen hides connect CTAs when offline', async ({
    page,
  }) => {
    await signInViaShim(page);
    await page.goto('/integrations/spotify');
    await flipNetworkOffline(page);
    await expect(page.getByText(/Connect Spotify when online/i)).toBeVisible({
      timeout: 10_000,
    });
  });
});
