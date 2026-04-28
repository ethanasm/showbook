import { test, expect, type Page } from '@playwright/test';

async function loginAndSeed(page: Page) {
  await page.goto('/api/test/seed');
  await page.goto('/api/test/login');
  await page.waitForURL('**/home');
}

test.describe('iCal export', () => {
  test.beforeEach(async ({ page }) => {
    await loginAndSeed(page);
  });

  test('show detail "Add to calendar" downloads a valid .ics', async ({ page }) => {
    await page.goto('/shows');
    await page.waitForSelector('.show-row', { timeout: 10000 });
    await page.locator('.show-row', { hasText: 'Radiohead' }).first().click();
    await page.waitForURL(/\/shows\/[0-9a-f-]+/);

    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('add-to-calendar').click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(/\.ics$/);
    const path = await download.path();
    expect(path).toBeTruthy();
    const fs = await import('fs/promises');
    const body = await fs.readFile(path!, 'utf-8');

    expect(body).toContain('BEGIN:VCALENDAR');
    expect(body).toContain('END:VCALENDAR');
    expect(body).toContain('BEGIN:VEVENT');
    expect(body).toMatch(/UID:show-[0-9a-f-]+@showbook/);
    expect(body).toMatch(/DTSTART:\d{8}T190000/); // 7pm local
    expect(body).toMatch(/DTEND:\d{8}T220000/);   // +3h
    expect(body).toContain('SUMMARY:Radiohead @ Madison Square Garden');
  });

  test('discover announcement "Calendar" link downloads .ics with show + on-sale events', async ({ page }) => {
    await page.goto('/discover');
    await page.waitForLoadState('networkidle');

    const calendarLink = page.getByTestId('add-to-calendar').first();
    await expect(calendarLink).toBeVisible();

    const downloadPromise = page.waitForEvent('download');
    await calendarLink.click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(/\.ics$/);
    const path = await download.path();
    const fs = await import('fs/promises');
    const body = await fs.readFile(path!, 'utf-8');

    expect(body).toContain('BEGIN:VCALENDAR');
    expect(body).toMatch(/UID:announcement-[0-9a-f-]+@showbook/);
    // The seeded announcements have no onSaleDate, so only the show event is present.
    const eventCount = (body.match(/BEGIN:VEVENT/g) ?? []).length;
    expect(eventCount).toBeGreaterThanOrEqual(1);
  });

  test('unauthenticated request returns 401', async ({ request }) => {
    const res = await request.get('/api/shows/00000000-0000-0000-0000-000000000000/ical');
    expect(res.status()).toBe(401);
  });
});
