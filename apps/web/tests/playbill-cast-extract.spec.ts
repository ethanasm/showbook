/**
 * Verifies the playbill upload feature on /add for theatre shows.
 *
 * Uses a real Hadestown playbill page as the fixture and hits Groq's vision
 * model live (test reuses the running dev server's GROQ_API_KEY).
 *
 * Two assertions matter:
 *   1. Only the principal cast is extracted — no swings, understudies,
 *      orchestra, dance/fight captains. (The Groq prompt at
 *      packages/api/src/groq.ts says "Skip ensemble, swing, and understudy
 *      listings"; this test verifies the model actually obeys.)
 *   2. Each extracted entry has both performer name (actor) and character
 *      name (role), and both persist after the show is saved.
 */
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { loginAndSeedAsWorker, workerShowId } from './helpers/auth';

const FIXTURE = path.join(__dirname, 'fixtures/playbills/Hadestown.png');

const MAIN_CAST: Array<{ actor: string; role: string }> = [
  { actor: 'Nickolaus Colón', role: 'Hades' },
  { actor: 'Jose Contreras', role: 'Orpheus' },
  { actor: 'Rudy Foster', role: 'Hermes' },
  { actor: 'Hawa Kamara', role: 'Eurydice' },
  { actor: 'Namisa Mdlalose Bizana', role: 'Persephone' },
  { actor: 'Gia Keddy', role: 'Fates' },
  { actor: 'Miriam Navarrete', role: 'Fates' },
  { actor: 'Jayna Wescoatt', role: 'Fates' },
  { actor: 'Jonice Bernard', role: 'Workers Chorus' },
  { actor: 'Bryan Chan', role: 'Workers Chorus' },
  { actor: 'Ryaan Farhadi', role: 'Workers Chorus' },
  { actor: 'Bernell Lassai III', role: 'Workers Chorus' },
  { actor: 'Erin McMillen', role: 'Workers Chorus' },
];

// Names that appear ONLY in the Swings / Orchestra blocks of the playbill.
// Names that appear in BOTH the main cast and the understudy list (e.g.
// Bryan Chan in Workers Chorus + understudy for Orpheus) are intentionally
// excluded here — the model is correct to extract them.
const SHOULD_NOT_APPEAR = [
  // Swings only
  'Michelle E. Carter',
  'Xavier McKnight',
  "Kaitlyn O'Leary",
  'Julia Schick',
  'Ty Shay',
  // Orchestra
  'Arman Wali Mohammad',
  'Jessie Bittner',
  'Haik Demirchian',
  'Nya Holmes',
  'Gabrielle Hooper',
  'Lumanyano Mzi',
  'Sam Wade',
  'Keith Levenson',
];

async function loginAsTestUser(page: Page) {
  await loginAndSeedAsWorker(page);
}

test.describe('Playbill cast extraction (Groq vision)', () => {
  // Vision call can be slow; allow plenty of headroom.
  test.setTimeout(120_000);

  // Skip when GROQ_API_KEY isn't configured (e.g. in CI without secrets).
  // Local dev with a valid key runs the test normally.
  test.skip(
    !process.env.GROQ_API_KEY,
    'GROQ_API_KEY not set',
  );

  test.beforeAll(() => {
    if (!fs.existsSync(FIXTURE)) {
      throw new Error(
        `Missing fixture at ${FIXTURE}. ` +
          'The Hadestown playbill PNG should be committed at this path.',
      );
    }
  });

  test('extracts only main cast — no swings, understudies, or orchestra', async ({ page }) => {
    await loginAsTestUser(page);
    await page.goto('/add');
    await page.waitForLoadState('networkidle');

    // Pick theatre so the playbill upload field renders.
    await page.getByRole('button', { name: /^theatre$/i }).first().click();

    // Upload the fixture.
    const fileInput = page.locator('input[type="file"][accept^="image"]').first();
    await fileInput.setInputFiles(FIXTURE);

    // Extracted Cast block appears once Groq returns.
    const extractedHeader = page.getByText(/extracted cast/i);
    await expect(extractedHeader).toBeVisible({ timeout: 90_000 });

    // Scope subsequent text assertions to the extracted-cast block so we
    // don't accidentally pick up text rendered elsewhere on the page.
    const castBlock = extractedHeader.locator('xpath=..');

    // Every main-cast actor + role pair must be present.
    for (const { actor, role } of MAIN_CAST) {
      await expect(
        castBlock.getByText(actor, { exact: false }),
        `expected main-cast actor "${actor}" in extracted cast`,
      ).toBeVisible();
      await expect(
        castBlock.getByText(role, { exact: false }).first(),
        `expected role "${role}" in extracted cast`,
      ).toBeVisible();
    }

    // Swings/orchestra names must not be present.
    for (const name of SHOULD_NOT_APPEAR) {
      await expect(
        castBlock.getByText(name, { exact: false }),
        `"${name}" should NOT be in extracted cast (swing or orchestra)`,
      ).toHaveCount(0);
    }
  });

  test('saves performer name + character name on the show after submit', async ({ page }) => {
    const productionName = `Hadestown Test ${Date.now()}`;

    await loginAsTestUser(page);
    await page.goto('/add');
    await page.waitForLoadState('networkidle');

    // 1. Pick theatre.
    await page.getByRole('button', { name: /^theatre$/i }).first().click();

    // 2. Production name.
    const productionInput = page.getByPlaceholder(/wicked, hamilton/i);
    await productionInput.fill(productionName);

    // 3. Past date.
    await page.locator('input[type="date"]').first().fill('2024-09-15');

    // 4. Venue — pick a seeded venue by typing and clicking the search result.
    const venueInput = page.getByPlaceholder(/search for a venue/i);
    await venueInput.click();
    await venueInput.fill('Gershwin');
    // Result row should appear with the seeded "Gershwin Theatre" venue.
    await page.getByText('Gershwin Theatre', { exact: false }).first().click();

    // 5. Upload the playbill and wait for extraction.
    const fileInput = page.locator('input[type="file"][accept^="image"]').first();
    await fileInput.setInputFiles(FIXTURE);
    await expect(page.getByText(/extracted cast/i)).toBeVisible({ timeout: 90_000 });

    // 6. Submit.
    const saveButton = page.getByRole('button', { name: /save to history/i });
    await expect(saveButton).toBeEnabled({ timeout: 5_000 });
    await saveButton.click();

    // 7. Look up the new show id (poll until the mutation lands).
    let id: string | null = null;
    await expect
      .poll(
        async () => {
          id = await workerShowId(page, { productionName, state: 'past' });
          return id;
        },
        { timeout: 8000 },
      )
      .toBeTruthy();
    expect(id, `show with productionName="${productionName}" must exist`).not.toBeNull();

    // 8. Verify lineup on the show detail page renders actor + character name.
    await page.goto(`/shows/${id}`);
    await page.waitForLoadState('networkidle');

    const lineupSection = page.locator('section').filter({ hasText: /lineup/i }).first();
    await expect(lineupSection).toBeVisible();

    for (const { actor, role } of MAIN_CAST) {
      await expect(
        lineupSection.getByText(actor, { exact: false }),
        `lineup should show actor "${actor}"`,
      ).toBeVisible();
      await expect(
        lineupSection.getByText(role, { exact: false }).first(),
        `lineup should show character "${role}"`,
      ).toBeVisible();
    }
  });
});
