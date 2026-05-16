/**
 * Spotify connect-modal Playwright spec (Phase 0 of setlist
 * intelligence). Doesn't go to real Spotify — instead it intercepts
 * the popup window before it can open, simulates the "spotify-connected"
 * postMessage that the OAuth callback would emit, and asserts the
 * preferences-side import flow resumes (calls `listFollowed` without
 * an `accessToken` arg).
 */

import { test, expect, type Page } from '@playwright/test';
import { loginAndSeedAsWorker } from './helpers/auth';

async function gotoPrefs(page: Page) {
  await page.goto('/preferences');
  await expect(page.getByText('Account', { exact: true })).toBeVisible({
    timeout: 15_000,
  });
}

test.describe('Spotify connect-once flow', () => {
  test('connect popup persists token; original action resumes', async ({ page }) => {
    await loginAndSeedAsWorker(page);

    // Stub `window.open` so the click never opens a real tab. We capture
    // the call so we can assert the OAuth URL matches our scope set.
    await page.addInitScript(() => {
      const origOpen = window.open;
      (
        window as unknown as {
          __spotifyOpenCalls?: { url: string }[];
        }
      ).__spotifyOpenCalls = [];
      (window as unknown as { open: typeof origOpen }).open = ((
        url?: string | URL,
      ) => {
        (
          window as unknown as { __spotifyOpenCalls: { url: string }[] }
        ).__spotifyOpenCalls.push({
          url: typeof url === 'string' ? url : url?.toString() ?? '',
        });
        // Return a non-null window-like object so the caller's
        // popup-blocker branch doesn't trigger.
        return {
          closed: false,
          close() {
            this.closed = true;
          },
          postMessage() {},
        } as unknown as Window;
      }) as typeof origOpen;
    });

    // Intercept the tRPC call we expect to resume after the popup posts
    // back. Mocking with a 200 + minimal payload lets us assert the
    // contract changed (no `accessToken` is required) without standing
    // up real Spotify.
    let listFollowedCalls = 0;
    let hadAccessTokenInBody = false;
    await page.route('**/api/trpc/spotifyImport.listFollowed*', async (route) => {
      listFollowedCalls += 1;
      const body = route.request().postData() ?? '';
      hadAccessTokenInBody = body.includes('"accessToken"');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          result: {
            data: {
              json: {
                artists: [],
                totalCount: 0,
                resolvedCount: 0,
                truncated: false,
              },
              meta: {
                values: {},
              },
            },
          },
        }),
      });
    });

    await gotoPrefs(page);

    // Click the existing "Connect Spotify" button (still wired through
    // useSpotifyImport — Phase 0 changed its postMessage shape but kept
    // the same UI affordance).
    const connectButton = page.getByRole('button', {
      name: /Connect Spotify/i,
    });
    await expect(connectButton).toBeVisible();
    await connectButton.click();

    // Verify the OAuth URL we *would* have opened includes the new
    // 8-scope set and the `state` param.
    const opens = await page.evaluate(
      () =>
        (window as unknown as { __spotifyOpenCalls?: { url: string }[] })
          .__spotifyOpenCalls ?? [],
    );
    expect(opens.length).toBe(1);
    expect(opens[0]?.url).toContain('/api/spotify');

    // Now simulate the callback's postMessage. The callback reuses the
    // same origin as the page, so dispatching a fake `message` event is
    // equivalent to what the real popup does.
    await page.evaluate(() => {
      window.postMessage(
        { type: 'spotify-connected', at: Date.now() },
        window.location.origin,
      );
    });

    // The hook reacts to the message → invalidates connectionStatus →
    // calls listFollowed (no accessToken arg). Wait for that to fire.
    await expect.poll(() => listFollowedCalls, { timeout: 5_000 }).toBe(1);
    expect(hadAccessTokenInBody).toBe(false);
  });
});
