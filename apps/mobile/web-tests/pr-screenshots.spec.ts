import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

// Visual capture for PRs that touch mobile UI. Renders the empty-state
// screens (which exercise the new design-system primitives — StackedCards,
// EmptyStateHero, GlowBackdrop, GradientEmphasis, monogram fallback
// RemoteImage on cards) at the mobile viewport (390×844 @ 2x = 780×1688)
// and writes a PNG per route into ./web-tests/.screenshots/.
//
// This spec is invoked by the pr-screenshots skill, not by the standard
// `pnpm mobile:web:test` run. The output directory is gitignored.

const TEST_SESSION = {
  token: 'pr-screenshots-token',
  user: {
    id: 'pr-screenshots-user',
    email: 'screenshots@showbook.dev',
    name: 'Screenshot Shim',
    image: null,
  },
};

const OUT_DIR = join(__dirname, '.screenshots');

// All routes the mobile bundle's empty/onboarding screens render. Each
// entry: { name, path, ready } — `ready` is the locator we wait on
// before capturing so we don't shoot mid-load.
const ROUTES: { name: string; path: string; ready: RegExp }[] = [
  { name: '01-home', path: '/', ready: /Build your\s*showbook/i },
  { name: '02-shows-empty', path: '/shows', ready: /Log your first show/i },
  { name: '03-artists-empty', path: '/artists', ready: /Build your lineup/i },
  { name: '04-venues-empty', path: '/venues', ready: /Map your stages/i },
  { name: '05-discover-empty', path: '/discover', ready: /A queue of what's next/i },
];

const variant = (process.env.PR_SCREENSHOT_VARIANT ?? 'after').toLowerCase();

test.beforeAll(() => {
  mkdirSync(OUT_DIR, { recursive: true });
});

test.describe('pr screenshots — mobile empty states', () => {
  for (const route of ROUTES) {
    test(`${route.name} (${variant})`, async ({ page }) => {
      await page.addInitScript(
        ({ token, userJson }) => {
          window.localStorage.setItem('secureStore::showbook.auth.token', token);
          window.localStorage.setItem('secureStore::showbook.auth.user', userJson);
          window.localStorage.setItem('secureStore::showbook.auth.firstRunComplete', 'true');
        },
        { token: TEST_SESSION.token, userJson: JSON.stringify(TEST_SESSION.user) },
      );

      // Stub every tRPC call to return an empty list-shaped payload.
      // The mobile client uses superjson, so the envelope is
      // `{ result: { data: { json } } }`. Discover queries expect
      // `{ items, hasRegions, nextCursor }`; everything else expects
      // an array or null. We return both shapes per-procedure.
      await page.route('**/api/trpc/**', async (route) => {
        const url = new URL(route.request().url());
        const procedurePath = url.pathname.split('/api/trpc/')[1] ?? '';
        const baseProcedure = procedurePath.split('?')[0] ?? '';
        const isBatch = url.searchParams.get('batch') === '1';
        const procedures = isBatch ? baseProcedure.split(',') : [baseProcedure];

        const dataFor = (proc: string): unknown => {
          if (proc.startsWith('discover.')) {
            return { items: [], hasRegions: false, nextCursor: null };
          }
          // shows.list, performers.list, performers.followed, venues.list,
          // venues.followed all return arrays — empty arrays trigger the
          // EmptyStateHero render branch.
          if (
            proc === 'shows.list' ||
            proc === 'performers.list' ||
            proc === 'performers.followed' ||
            proc === 'venues.list' ||
            proc === 'venues.followed'
          ) {
            return [];
          }
          return null;
        };

        const results = procedures.map((p) => ({
          result: { data: { json: dataFor(p) } },
        }));

        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(isBatch ? results : results[0]),
        });
      });

      await page.goto(route.path);

      // Wait for the screen's signature copy to be visible so we don't
      // capture mid-load. Each route has its own ready regex; if the
      // current variant doesn't show that copy (e.g. running BEFORE
      // against the previous EmptyState component), fall back to a
      // soft-wait so we still capture something usable.
      try {
        await expect(page.getByText(route.ready).first()).toBeVisible({
          timeout: 8_000,
        });
      } catch {
        // The "before" run uses the old copy ("No shows yet", etc.) so
        // the strict match misses. Wait for any tablist instead, which
        // means the app rendered without crashing.
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(500);
      }

      // Settle a beat to let the StackedCards drift animation start its
      // first frame, but cap the wait so we don't slow down the run.
      await page.waitForTimeout(600);

      await page.screenshot({
        path: join(OUT_DIR, `${route.name}-${variant}.png`),
        fullPage: true,
        animations: 'disabled',
      });
    });
  }
});
