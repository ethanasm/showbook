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

interface RouteSpec {
  name: string;
  path: string;
  /** Regex to wait on before capturing. */
  ready: RegExp;
  /** Skip the auth-seed init script (used for the signed-out sign-in screen). */
  skipAuthSeed?: boolean;
  /** Per-procedure tRPC stubs. Keys are procedure paths
   *  (e.g. "songs.byId"). Values are the raw `data.json` payload. */
  trpcStubs?: Record<string, unknown>;
  /** When true, scroll the page (and any inner RN Web ScrollView) to
   *  the bottom before snapshotting. Use for screens whose visible
   *  delta is below the fold on the 390×844 viewport. */
  scrollToBottom?: boolean;
}

const ROUTES: RouteSpec[] = [
  // Sign-in screen — captures the StackedCards swap from flat to crooked.
  // The route is auth-gated upstream; skipping the auth seed routes us to
  // the sign-in screen directly.
  {
    name: '00-signin',
    path: '/',
    ready: /Sign in with Google/i,
    skipAuthSeed: true,
  },
  // Empty-state coverage (carries over from PR #250 visual review).
  { name: '01-home', path: '/', ready: /Build your\s*showbook/i },
  { name: '02-shows-empty', path: '/shows', ready: /Log your first show/i },
  { name: '03-artists-empty', path: '/artists', ready: /Build your lineup/i },
  { name: '04-venues-empty', path: '/venues', ready: /Map your stages/i },
  { name: '05-discover-empty', path: '/discover', ready: /Follow a venue|A queue of what's next/i },
  // New feature: festival poster splash. Idle state pre-pick is enough to
  // demo the entry point — picking an image requires a real OS picker.
  {
    name: '06-festival-poster',
    path: '/add/festival-poster',
    ready: /Read a poster, get the lineup/i,
  },
  // New feature: Spotify import affordance on the integrations screen.
  // Stub the connection-status query to "connected" so the picker CTA
  // renders instead of the disconnected splash.
  {
    name: '07-spotify-import',
    path: '/integrations/spotify',
    ready: /Import followed artists|IMPORT FOLLOWED ARTISTS/i,
    trpcStubs: {
      'spotify.connectionStatus': {
        connected: true,
        displayName: 'Screenshot Shim',
        product: 'premium',
        spotifyUserId: 'shim',
      },
    },
  },
  // Me tab — covers the Recent-Activity-removal + version-footer cleanup.
  // Both deltas sit below the fold on a 390×844 viewport, so scroll the
  // inner ScrollView to the bottom before snapshotting.
  {
    name: '09-me-tab',
    path: '/me',
    ready: /SHOWBOOK · v/i,
    scrollToBottom: true,
    trpcStubs: {
      'preferences.get': {
        regions: [],
        notifications: { email: false, push: false },
        emailDigest: { enabled: false },
      },
      'spotify.connectionStatus': { connected: false },
    },
  },
  // First-run Gmail step — covers the "Connect Gmail → Got it" rewrite
  // so the CTA no longer promises an OAuth flow we haven't built.
  {
    name: '10-first-run-gmail',
    path: '/(auth)/first-run/gmail',
    ready: /Pull in past tickets|Got it/i,
    skipAuthSeed: true,
  },
  // Upload screen — covers the dual Camera / Photo-library chooser. The
  // web shim returns `canceled: true` from the auto-pick on mount so the
  // empty state renders.
  {
    name: '11-upload-chooser',
    path: '/show/screenshot-show/upload',
    ready: /Add a photo or video|Take photo/i,
  },
  // New feature: songs detail. Stub `songs.byId` with a representative
  // history so the hero + stat row + timeline all populate.
  {
    name: '08-songs-detail',
    path: '/songs/screenshot-song',
    ready: /YOUR TIMELINE|live history|Song · You Heard Live/i,
    trpcStubs: {
      'songs.byId': {
        song: {
          id: 'screenshot-song',
          title: 'Motion Sickness',
          performerId: 'screenshot-performer',
          performerName: 'Phoebe Bridgers',
          spotifyTrackId: null,
          firstKnownPerformance: '2018-09-12',
        },
        timesHeard: 3,
        firstHeard: {
          showId: 'screenshot-show-a',
          date: '2018-09-12',
          venueName: 'Bowery Ballroom',
          venueCity: 'New York',
        },
        lastHeard: {
          showId: 'screenshot-show-c',
          date: '2024-05-04',
          venueName: 'Madison Square Garden',
          venueCity: 'New York',
        },
        timeline: [
          {
            showId: 'screenshot-show-a',
            date: '2018-09-12',
            sectionIndex: 0,
            songIndex: 4,
            isEncore: false,
            role: 'core',
            venueName: 'Bowery Ballroom',
            venueCity: 'New York',
          },
          {
            showId: 'screenshot-show-b',
            date: '2022-07-19',
            sectionIndex: 0,
            songIndex: 12,
            isEncore: false,
            role: 'core',
            venueName: 'Forest Hills Stadium',
            venueCity: 'Queens',
          },
          {
            showId: 'screenshot-show-c',
            date: '2024-05-04',
            sectionIndex: 1,
            songIndex: 1,
            isEncore: true,
            role: 'encore',
            venueName: 'Madison Square Garden',
            venueCity: 'New York',
          },
        ],
        rarity: { corpusHits: 14, corpusTotal: 22, fractionPct: 64 },
      },
    },
  },
];

const variant = (process.env.PR_SCREENSHOT_VARIANT ?? 'after').toLowerCase();

test.beforeAll(() => {
  mkdirSync(OUT_DIR, { recursive: true });
});

test.describe('pr screenshots — mobile', () => {
  for (const route of ROUTES) {
    test(`${route.name} (${variant})`, async ({ page }) => {
      if (!route.skipAuthSeed) {
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

      // Stub every tRPC call. Per-route `trpcStubs` win for matching
      // procedures; the rest fall back to empty payloads so screens that
      // render data-driven UI land on their empty-state branch.
      await page.route('**/api/trpc/**', async (route_) => {
        const url = new URL(route_.request().url());
        const procedurePath = url.pathname.split('/api/trpc/')[1] ?? '';
        const baseProcedure = procedurePath.split('?')[0] ?? '';
        const isBatch = url.searchParams.get('batch') === '1';
        const procedures = isBatch ? baseProcedure.split(',') : [baseProcedure];

        const dataFor = (proc: string): unknown => {
          if (route.trpcStubs && proc in route.trpcStubs) {
            return route.trpcStubs[proc];
          }
          if (proc.startsWith('discover.')) {
            return { items: [], hasRegions: false, nextCursor: null };
          }
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

        await route_.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(isBatch ? results : results[0]),
        });
      });

      await page.goto(route.path);

      try {
        await expect(page.getByText(route.ready).first()).toBeVisible({
          timeout: 8_000,
        });
      } catch {
        // BEFORE captures against the parent commit won't always show the
        // new copy — fall back to a soft wait so the capture still
        // succeeds against the pre-change tree.
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(500);
      }

      // Settle for any Reanimated frames before snapshotting.
      await page.waitForTimeout(600);

      if (route.scrollToBottom) {
        // RN Web ScrollView renders as an overflow:scroll div. Find any
        // descendant whose content overflows and scroll it to the
        // bottom — covers both the window and the inner ScrollView.
        await page.evaluate(() => {
          window.scrollTo(0, document.body.scrollHeight);
          const scrollables = Array.from(
            document.querySelectorAll('*'),
          ).filter((el) => {
            const style = getComputedStyle(el);
            return (
              (style.overflowY === 'auto' || style.overflowY === 'scroll') &&
              el.scrollHeight > el.clientHeight
            );
          });
          for (const el of scrollables) {
            (el as HTMLElement).scrollTop = el.scrollHeight;
          }
        });
        await page.waitForTimeout(250);
      }

      await page.screenshot({
        path: join(OUT_DIR, `${route.name}-${variant}.png`),
        fullPage: true,
        animations: 'disabled',
      });
    });
  }
});
