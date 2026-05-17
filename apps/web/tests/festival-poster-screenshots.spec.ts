/**
 * One-off Playwright spec for the PR #200 visual review: captures the
 * festival poster upload field on /add (form mode) and the
 * FestivalLineupModal in its picker state.
 *
 * Stubs `enrichment.extractFestivalLineup` and `enrichment.matchFestivalArtists`
 * since the sandbox has no GROQ_API_KEY / TICKETMASTER_API_KEY. Gated on
 * `PR_SCREENSHOTS=1` so it only runs when the screenshots skill needs it.
 */

import { test, expect } from '@playwright/test';
import path from 'node:path';
import { loginAndSeedAsWorker } from './helpers/auth';

test.skip(
  process.env.PR_SCREENSHOTS !== '1',
  'PR_SCREENSHOTS=1 required (one-off visual-review spec)',
);

const FAKE_LINEUP = {
  festivalName: 'Governors Ball 2026',
  startDate: '2026-06-06',
  endDate: '2026-06-08',
  venueHint: 'Flushing Meadows, NYC',
  artists: [
    { name: 'Olivia Rodrigo', tier: 'headliner' },
    { name: 'Tyler, The Creator', tier: 'headliner' },
    { name: 'Hozier', tier: 'headliner' },
    { name: 'Vampire Weekend', tier: 'headliner' },
    { name: 'Mannequin Pussy', tier: 'support' },
    { name: 'Phoebe Bridgers', tier: 'support' },
    { name: 'Wet Leg', tier: 'support' },
    { name: 'beabadoobee', tier: 'support' },
    { name: 'Indigo De Souza', tier: 'support' },
    { name: 'Black Country, New Road', tier: 'support' },
    { name: 'Caroline Polachek', tier: 'support' },
    { name: 'Snail Mail', tier: 'support' },
    { name: 'Soccer Mommy', tier: 'support' },
    { name: 'Wednesday', tier: 'support' },
  ],
};

// Wrap a value in the tRPC + superjson response envelope. The web app's
// tRPC client uses `transformer: superjson`, so each batch entry must
// be `{ result: { data: { json: <value>, meta: { values: {} } } } }`.
function trpcOk(value: unknown) {
  return [{ result: { data: { json: value, meta: { values: {} } } } }];
}

const HIDE_DEV_INDICATOR = `
  [data-nextjs-toast],
  [data-nextjs-dev-tools-button],
  [data-nextjs-dev-tools-menu],
  nextjs-portal { display: none !important; }
`;

test('festival lineup upload field + picker modal', async ({ page }) => {
  test.setTimeout(120_000);

  // ── tRPC stubs ──────────────────────────────────────────────────────
  // tRPC batches procedures into a comma-separated URL like
  // `/api/trpc/enrichment.extractFestivalLineup,enrichment.matchFestivalArtists`.
  // We catch the festival ones and let everything else fall through.
  await page.route('**/api/trpc/**', async (route) => {
    const url = new URL(route.request().url());
    const procPath = url.pathname.slice('/api/trpc/'.length);
    const procs = procPath.split(',');
    if (procs.length === 1 && procs[0] === 'enrichment.extractFestivalLineup') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(trpcOk(FAKE_LINEUP)),
      });
      return;
    }
    if (procs.length === 1 && procs[0] === 'enrichment.matchFestivalArtists') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          trpcOk({
            matches: FAKE_LINEUP.artists.map((a, i) => {
              // Give the first half artist images; leave the rest as
              // "no tm match" so the picker shows both states.
              const matched = i < FAKE_LINEUP.artists.length / 2;
              return {
                name: a.name,
                tmAttractionId: matched ? `tm-${i}` : null,
                tmName: matched ? a.name : null,
                imageUrl: matched
                  ? `https://picsum.photos/seed/festival${i}/72/72`
                  : null,
                musicbrainzId: null,
              };
            }),
          }),
        ),
      });
      return;
    }
    await route.continue();
  });

  await loginAndSeedAsWorker(page);
  await page.goto('/add');
  await page.waitForLoadState('networkidle');
  await page.addStyleTag({ content: HIDE_DEV_INDICATOR });

  // Pick **Festival** kind. The button's accessible name concatenates
  // icon + "Festival" + "multi-day lineup" enrichment hint, so match
  // loosely rather than with anchored regex.
  await page
    .getByRole('button')
    .filter({ hasText: /multi-day lineup/i })
    .first()
    .click();

  // Wait for the form to swap into festival mode (the "Festival Name"
  // input renders only after kind = festival).
  await expect(page.getByPlaceholder(/Governors Ball, Coachella/i)).toBeVisible();

  // Fill in the festival name + a past date so the form renders the rest.
  // (We don't strictly need a date for the screenshot but it helps the
  // preview panel render in a recognizable state.)
  await page.getByPlaceholder(/Governors Ball, Coachella/i).fill('Governors Ball 2026');

  // ── Capture 1: the "Poster or Schedule" upload affordance in form ──
  const posterField = page.locator('text=Poster or Schedule').first().locator('xpath=ancestor::*[3]');
  await expect(posterField).toBeVisible();
  await posterField.scrollIntoViewIfNeeded();
  await posterField.screenshot({
    path: path.join(__dirname, '../test-results/screenshots/festival-upload-field.png'),
  });

  // ── Trigger the picker via the hidden file input ────────────────────
  // The picker modal opens immediately, then transitions to "picking" as
  // soon as the stubbed extract resolves.
  const fileInput = page.locator('input[type="file"][accept*="application/pdf"]').first();
  const dummyPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgAAIAAAUAAeImBZsAAAAASUVORK5CYII=',
    'base64',
  );
  await fileInput.setInputFiles({
    name: 'governors-ball-2026.png',
    mimeType: 'image/png',
    buffer: dummyPng,
  });

  // Modal renders — wait for the "Add to show" button (footer) to be
  // visible, which means we're in the `picking` phase.
  const submitButton = page.getByRole('button', { name: /add to show/i });
  await expect(submitButton).toBeVisible({ timeout: 30_000 });

  // Give TM matching's images a beat to load (picsum can be slow first
  // call). We don't block on it — `networkidle` is too strict for the
  // image CDN.
  await page.waitForTimeout(2_500);

  // ── Capture 2: the full picker modal (full page so the dimmed bg
  // shows the form behind it) ─────────────────────────────────────────
  await page.screenshot({
    path: path.join(__dirname, '../test-results/screenshots/festival-picker-modal.png'),
    fullPage: false,
  });

  // ── Capture 3: zoom in on a few rows so reviewers can read the per-
  // row tier toggle clearly. Crop to the dialog itself. ───────────────
  const dialog = page.locator('text=Governors Ball 2026').first().locator('xpath=ancestor::*[5]');
  const dialogBox = await dialog.boundingBox();
  if (dialogBox) {
    await page.screenshot({
      path: path.join(__dirname, '../test-results/screenshots/festival-picker-rows.png'),
      clip: {
        x: dialogBox.x,
        y: dialogBox.y,
        width: dialogBox.width,
        height: Math.min(dialogBox.height, 520),
      },
    });
  }

  // ── Capture 4: chat-mode composer with the 📎 attach button ─────────
  // Close the modal, switch to Chat mode, and capture the chat composer
  // row (textarea + new paperclip button + send).
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: /add to show/i })).toBeHidden();
  await page.getByRole('button', { name: /^conversational$/i }).first().click();

  const chatArea = page.getByPlaceholder(/Describe your show/i);
  await expect(chatArea).toBeVisible();
  const chatRow = chatArea.locator('xpath=parent::*');
  const chatBox = await chatRow.boundingBox();
  if (chatBox) {
    await page.screenshot({
      path: path.join(__dirname, '../test-results/screenshots/festival-chat-composer.png'),
      clip: {
        x: chatBox.x - 12,
        y: chatBox.y - 12,
        width: Math.min(chatBox.width + 24, page.viewportSize()!.width - chatBox.x + 12),
        height: chatBox.height + 24,
      },
    });
  }
});
