import { test, expect } from '@playwright/test';
import { loginAsEmptyWorker } from './helpers/auth';

// Routes whose empty state renders an action region. /home falls through to a
// different surface (GetStartedHub) so we exercise it separately below.
const EMPTY_STATE_ROUTES = ['/upcoming', '/logbook', '/discover', '/artists', '/venues', '/map'];

test('empty-state action buttons clear the mobile bottom nav after scrolling', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'mobile-only regression');
  test.setTimeout(120_000);

  await loginAsEmptyWorker(page);

  for (const route of EMPTY_STATE_ROUTES) {
    await page.goto(route);
    await page.waitForLoadState('domcontentloaded');
    // Wait for the empty-state to mount (data loads + skeleton clears).
    await page.locator('.empty-state__action').first().waitFor({ state: 'attached', timeout: 15_000 });

    // Scroll every scrollable ancestor of the action to its bottom so we
    // measure the worst-case visible position of the action region.
    const measurements = await page.evaluate(() => {
      const action = document.querySelector('.empty-state__action') as HTMLElement | null;
      // Walk up from the action element and bottom-scroll any ancestor that
      // has its own overflow:auto/scroll. This handles both the page-level
      // .app-shell__content and any nested scrollers (e.g. .discover-main).
      let cursor: HTMLElement | null = action?.parentElement ?? null;
      while (cursor) {
        const cs = getComputedStyle(cursor);
        if (cs.overflowY === 'auto' || cs.overflowY === 'scroll') {
          cursor.scrollTop = cursor.scrollHeight;
        }
        cursor = cursor.parentElement;
      }
      const bottomBar = document.querySelector('.app-shell__bottom-bar') as HTMLElement | null;
      return {
        actionBottom: action?.getBoundingClientRect().bottom ?? null,
        bottomBarTop: bottomBar?.getBoundingClientRect().top ?? null,
      };
    });

    expect(
      measurements.actionBottom,
      `${route}: empty-state action region missing`,
    ).not.toBeNull();
    expect(
      measurements.bottomBarTop,
      `${route}: bottom nav missing`,
    ).not.toBeNull();
    expect(
      measurements.actionBottom! <= measurements.bottomBarTop!,
      `${route}: action bottom (${measurements.actionBottom}) overlaps bottom nav top (${measurements.bottomBarTop})`,
    ).toBe(true);
  }

  // Home renders GetStartedHub (expanded variant), which is its own
  // surface — assert the last "door" is reachable above the bottom nav.
  await page.goto('/home');
  await page.waitForLoadState('domcontentloaded');
  await page.locator('[data-testid="get-started-hub"]').first().waitFor({ state: 'attached', timeout: 15_000 });

  const homeMeasurements = await page.evaluate(() => {
    let cursor: HTMLElement | null = document.querySelector('[data-testid="get-started-hub"]');
    while (cursor) {
      const cs = getComputedStyle(cursor);
      if (cs.overflowY === 'auto' || cs.overflowY === 'scroll') {
        cursor.scrollTop = cursor.scrollHeight;
      }
      cursor = cursor.parentElement;
    }
    const doors = Array.from(
      document.querySelectorAll('[data-testid^="get-started-door-"]'),
    ) as HTMLElement[];
    const lastDoorBottom = doors.length
      ? Math.max(...doors.map((d) => d.getBoundingClientRect().bottom))
      : null;
    const bottomBar = document.querySelector('.app-shell__bottom-bar') as HTMLElement | null;
    return {
      lastDoorBottom,
      bottomBarTop: bottomBar?.getBoundingClientRect().top ?? null,
    };
  });

  expect(homeMeasurements.lastDoorBottom).not.toBeNull();
  expect(
    homeMeasurements.lastDoorBottom! <= homeMeasurements.bottomBarTop!,
    `/home: last door bottom (${homeMeasurements.lastDoorBottom}) overlaps bottom nav top (${homeMeasurements.bottomBarTop})`,
  ).toBe(true);
});
