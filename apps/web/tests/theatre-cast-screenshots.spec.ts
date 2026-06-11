/**
 * One-off Playwright spec for the PR #527 visual review: captures the
 * theatre cast typeahead on /add — the Wikidata-backed dropdown (with
 * disambiguating subtitles) and the populated Cast section showing the
 * per-row character-name field + "✓ matched" state.
 *
 * Stubs `performers.searchExternal` (the theatre branch hits Wikidata,
 * which the sandbox can reach but we stub for deterministic screenshots).
 * Gated on `PR_SCREENSHOTS=1` so it only runs when the screenshots skill
 * needs it.
 */

import { test, expect } from '@playwright/test';
import path from 'node:path';
import { loginAndSeedAsWorker } from './helpers/auth';

test.skip(
  process.env.PR_SCREENSHOTS !== '1',
  'PR_SCREENSHOTS=1 required (one-off visual-review spec)',
);

// Wikidata-shaped searchExternal results for the theatre branch.
const FAKE_CAST = [
  {
    tmAttractionId: null,
    wikidataQid: 'Q40281836',
    name: 'Cole Escola',
    imageUrl: 'https://picsum.photos/seed/cole/72/72',
    musicbrainzId: null,
    subtitle: 'American comedian, actor, and playwright',
  },
  {
    tmAttractionId: null,
    wikidataQid: 'Q20031439',
    name: 'Betty Gilpin',
    imageUrl: 'https://picsum.photos/seed/betty/72/72',
    musicbrainzId: 'mb-betty',
    subtitle: 'American actress',
  },
  {
    tmAttractionId: null,
    wikidataQid: 'Q102151',
    name: 'Conrad Ricamora',
    imageUrl: 'https://picsum.photos/seed/conrad/72/72',
    musicbrainzId: null,
    subtitle: 'American actor and singer',
  },
];

function trpcOk(value: unknown) {
  return [{ result: { data: { json: value, meta: { values: {} } } } }];
}

const HIDE_DEV_INDICATOR = `
  [data-nextjs-toast],
  [data-nextjs-dev-tools-button],
  [data-nextjs-dev-tools-menu],
  nextjs-portal { display: none !important; }
`;

test('theatre cast typeahead + populated cast section', async ({ page }) => {
  test.setTimeout(120_000);

  await page.route('**/api/trpc/**', async (route) => {
    const url = new URL(route.request().url());
    const procPath = url.pathname.slice('/api/trpc/'.length);
    const procs = procPath.split(',');
    if (procs.length === 1 && procs[0] === 'performers.searchExternal') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(trpcOk(FAKE_CAST)),
      });
      return;
    }
    await route.continue();
  });

  await loginAndSeedAsWorker(page);
  await page.goto('/add?mode=form');
  await page.addStyleTag({ content: HIDE_DEV_INDICATOR });

  // Pick the Theatre kind (auto-waits for the button to be actionable;
  // `networkidle` is unreliable here because the app polls in the bg).
  await page.getByRole('button', { name: /Theatre/i }).first().click();

  // Show Title renders only after kind = theatre.
  const title = page.getByPlaceholder(/Wicked, Hamilton/i);
  await expect(title).toBeVisible();
  await title.fill('Oh, Mary!');

  // ── Capture 1: the cast typeahead dropdown with Wikidata subtitles ──
  const castSearch = page.getByPlaceholder('search cast...');
  await expect(castSearch).toBeVisible();
  // The bordered lineup card (CAST rows + search input + dropdown) — the
  // search row is a grid div, its parent is the bordered container.
  const castCard = castSearch.locator('xpath=ancestor::div[2]');
  await castCard.scrollIntoViewIfNeeded();
  await castSearch.fill('cole escola');
  // Wait for the stubbed dropdown to render (matches on subtitle text).
  await expect(
    page.getByText('American comedian, actor, and playwright'),
  ).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(800); // let picsum thumbs settle

  await castCard.screenshot({
    path: path.join(
      __dirname,
      '../test-results/screenshots/theatre-cast-typeahead.png',
    ),
  });

  // Select Cole Escola → a cast row appears with a character-name field.
  // Target the result row by its (unique) Wikidata subtitle so we don't
  // hit the "Add \"cole escola\"" manual-entry button that sorts first.
  await page
    .getByRole('button')
    .filter({ hasText: 'American comedian, actor, and playwright' })
    .first()
    .click();
  await page
    .getByPlaceholder('character / role (optional)')
    .first()
    .fill('Mary Todd Lincoln');

  // Add a second cast member.
  await castSearch.fill('betty gilpin');
  await expect(page.getByText('American actress')).toBeVisible({ timeout: 15_000 });
  await page
    .getByRole('button')
    .filter({ hasText: 'American actress' })
    .first()
    .click();
  const characterInputs = page.getByPlaceholder('character / role (optional)');
  await characterInputs.nth(1).fill("Mary's Understudy");

  // ── Capture 2: the populated Cast section (rows + character fields +
  // "✓ matched") ──────────────────────────────────────────────────────
  await page.waitForTimeout(500);
  await castCard.screenshot({
    path: path.join(
      __dirname,
      '../test-results/screenshots/theatre-cast-section.png',
    ),
  });
});

test('built-in integrations section on preferences', async ({ page }) => {
  test.setTimeout(120_000);
  await loginAndSeedAsWorker(page);
  await page.goto('/preferences');
  await page.addStyleTag({ content: HIDE_DEV_INDICATOR });

  const heading = page.getByText('Built-in integrations', { exact: true });
  await expect(heading).toBeVisible({ timeout: 15_000 });
  await heading.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);

  const box = await heading.boundingBox();
  if (box) {
    await page.screenshot({
      path: path.join(
        __dirname,
        '../test-results/screenshots/builtin-integrations.png',
      ),
      clip: {
        x: Math.max(0, box.x - 16),
        y: box.y - 12,
        width: Math.min(760, page.viewportSize()!.width - box.x + 16),
        height: 360,
      },
    });
  }
});
