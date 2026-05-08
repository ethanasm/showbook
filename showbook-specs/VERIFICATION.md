# Showbook — Verification Strategy

How Claude Code agents verify their work: functional testing, visual verification, and data integrity checks.

---

## Tools

**Playwright** — browser automation for functional tests and screenshots. Every UI task produces Playwright tests that:
1. Test that the feature works (clicks, navigation, data loading, form submission)
2. Take screenshots at key states for visual inspection

**psql / Drizzle queries** — for data layer verification. After any operation that touches the DB, query directly to confirm the data is correct.

---

## Playwright Setup

```typescript
// apps/web/playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  use: {
    baseURL: 'http://localhost:3000',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop-dark', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 } } },
  ],
  webServer: {
    command: 'npx nx dev web',
    port: 3000,
    reuseExistingServer: true,
  },
});
```

Run two viewports: desktop (1440×900, matching the web prototypes) and mobile (390×844, matching the iPhone frame in the prototypes).

---

## Screenshot Strategy

Every UI task takes screenshots at specific states. Screenshots serve two purposes:
1. **Visual inspection by the agent** — the agent looks at the screenshot and compares it to the design intent described in the spec
2. **Regression baseline** — saved screenshots can be compared in future runs

### Screenshot naming convention

```
{page}-{state}-{viewport}.png

Examples:
  home-with-data-desktop-dark.png
  home-empty-state-mobile.png
  shows-list-all-states-desktop-dark.png
  shows-expanded-row-desktop-dark.png
  add-form-step-1-kind-mobile.png
  add-form-tm-results-desktop-dark.png
  discover-followed-tab-desktop-dark.png
  map-pin-inspector-desktop-dark.png
```

### What to screenshot per page

**Home:**
- Hero card with ticketed show + recent 5 past shows
- Empty state (no shows)
- Hero with countdown < 24h (different styling?)

**Shows:**
- List mode with all 3 states visible (past, ticketed, watching)
- Expanded row showing detail panel
- Calendar mode with show dots
- Stats mode with counts
- Year rail filtering (show 2024 vs 2025)
- Empty state

**Add:**
- Kind selection step
- TM search results panel
- Venue typeahead
- Setlist enrichment result
- Cast extraction result (theatre)
- Chat mode with parsed fields
- Form fully filled before save

**Discover:**
- Followed tab with announcements grouped by venue
- Near You tab
- Watched state (after tapping Watch)
- Empty state (no followed venues)

**Map:**
- Full map with multiple pins
- Venue inspector panel open
- Inspector showing show history

**Preferences:**
- Full page in dark mode
- Full page after switching to light mode
- Region list with active/inactive

---

## Functional Test Patterns

Playwright runs against the isolated `showbook_e2e` database, not the local dev
`showbook` database. Use `pnpm test:e2e`; it resets/migrates `showbook_e2e`
and starts a Playwright-owned Next.js server on `https://localhost:3003`
(override with `PLAYWRIGHT_PORT`) with `ENABLE_TEST_ROUTES=1`.

The `/api/test/*` routes are intentionally unavailable on the normal dev server
unless both conditions are true:
- `ENABLE_TEST_ROUTES=1`
- `DATABASE_URL` points at `showbook_e2e`

### Auth helper
```typescript
// tests/helpers/auth.ts
export async function loginAsTestUser(page: Page) {
  // For testing, use a test account or mock the auth session
  // Option 1: Set a session cookie directly
  // Option 2: Use NextAuth's test helpers
  // Option 3: Create a test endpoint that creates a session
  await page.goto('/api/test/login');
  await page.waitForURL('/home');
}
```

### Seed data helper
```typescript
// tests/helpers/seed.ts
import { db } from '@showbook/db';
import { shows, venues, performers, showPerformers, announcements } from '@showbook/db/schema';

export async function seedTestData() {
  // Create venues
  const msg = await db.insert(venues).values({
    name: 'Madison Square Garden',
    neighborhood: 'Midtown',
    city: 'New York',
    stateRegion: 'NY',
    country: 'US',
    latitude: 40.7505,
    longitude: -73.9934,
  }).returning();

  // Create performers
  const radiohead = await db.insert(performers).values({
    name: 'Radiohead',
    ticketmasterAttractionId: 'K8vZ9171oZf',
  }).returning();

  // Create shows across all states and kinds
  // ... (full seed in the actual implementation)
}

export async function cleanTestData() {
  await db.delete(showPerformers);
  await db.delete(shows);
  await db.delete(performers);
  await db.delete(announcements);
  await db.delete(venues);
}
```

### Page test pattern
```typescript
// tests/shows.spec.ts
import { test, expect } from '@playwright/test';
import { loginAsTestUser } from './helpers/auth';
import { seedTestData, cleanTestData } from './helpers/seed';

test.describe('Shows page', () => {
  test.beforeAll(async () => {
    await seedTestData();
  });

  test.afterAll(async () => {
    await cleanTestData();
  });

  test.beforeEach(async ({ page }) => {
    await loginAsTestUser(page);
  });

  test('renders shows with correct state styling', async ({ page }) => {
    await page.goto('/logbook');
    await page.waitForSelector('[data-testid="show-row"]');

    // Verify all 3 states are visible
    await expect(page.locator('[data-state="past"]')).toBeVisible();
    await expect(page.locator('[data-state="ticketed"]')).toBeVisible();
    await expect(page.locator('[data-state="watching"]')).toBeVisible();

    // Screenshot for visual inspection
    await page.screenshot({ path: 'test-results/screenshots/shows-list-all-states.png', fullPage: true });
  });

  test('expands row on click', async ({ page }) => {
    await page.goto('/logbook');
    await page.locator('[data-testid="show-row"]').first().click();
    await expect(page.locator('[data-testid="show-detail-panel"]')).toBeVisible();
    await page.screenshot({ path: 'test-results/screenshots/shows-expanded-row.png', fullPage: true });
  });

  test('filters by year', async ({ page }) => {
    await page.goto('/logbook');
    await page.locator('[data-testid="year-2024"]').click();
    // Verify only 2024 shows visible
    const rows = page.locator('[data-testid="show-row"]');
    for (const row of await rows.all()) {
      await expect(row.locator('[data-testid="show-date"]')).toContainText('2024');
    }
  });
});
```

---

## Data Integrity Checks

After any operation that writes to the DB, verify:

### Show creation
```sql
-- After creating a show via the Add flow:
SELECT s.*, v.name as venue_name,
       array_agg(p.name) as performer_names
FROM shows s
JOIN venues v ON s.venue_id = v.id
JOIN show_performers sp ON sp.show_id = s.id
JOIN performers p ON sp.performer_id = p.id
WHERE s.id = '{new_show_id}'
GROUP BY s.id, v.name;

-- Verify:
-- ✓ show.state is correct for the date (past if past, ticketed if future + has seat)
-- ✓ venue_id points to correct venue (not a duplicate)
-- ✓ show_performers rows exist with correct roles
-- ✓ source_refs contains TM event ID if enriched
```

### Watchlist action
```sql
-- After watchlisting an announcement:
SELECT s.state, s.kind, sal.announcement_id
FROM shows s
JOIN show_announcement_link sal ON sal.show_id = s.id
WHERE sal.announcement_id = '{announcement_id}';

-- Verify:
-- ✓ show.state = 'watching'
-- ✓ show_announcement_link row exists
-- ✓ show has headliner, venue, date, kind from the announcement
```

### State transition
```sql
-- After nightly job runs:
SELECT id, state, date FROM shows
WHERE state = 'ticketed' AND date < CURRENT_DATE;

-- Should return 0 rows (all transitioned to past)

SELECT id, state, date FROM shows
WHERE state = 'watching' AND date < CURRENT_DATE;

-- Should return 0 rows (all deleted)
```

---

## Visual Verification Checklist

When an agent takes a screenshot, it should check against these design rules from the project README:

**Typography:**
- Headliners and body text are in Geist (sans)
- Labels, metadata, timestamps, and nav items are in Geist Mono

**Kind colors (left border bars and badges):**
- Concert: Stage Blue (#2E6FD9 light / #3A86FF dark)
- Theatre: Curtain Crimson (#D42F3A light / #E63946 dark)
- Comedy: Quirky Amethyst (#8340C4 light / #9D4EDD dark)
- Festival: Outdoor Teal (#238577 light / #2A9D8F dark)

**State rendering in Shows list:**
- Past: solid kind-color left bar, no chip
- Ticketed: solid ink left bar, "TIX" chip in Marquee Gold
- Watching: dashed ink left bar, "WATCHING" chip in Marquee Gold

**Marquee Gold accent:**
- Light mode: #E5A800
- Dark mode: #FFD166
- Used on: CTAs, active nav, TIX/WATCHING chips, interactive links
- Never on kind labels

**Surfaces:**
- Dark mode background: #0C0C0C
- Light mode background: #FAFAF8
