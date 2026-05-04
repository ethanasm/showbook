import { test, expect, type Page } from '@playwright/test';
import { loginAndSeedAsWorker } from './helpers/auth';

async function loginAndSeed(page: Page) {
  await loginAndSeedAsWorker(page);
}

/**
 * The pagination footer must stay pinned to the bottom of the viewport on
 * every list page. The seed fixture does not always exceed a single page, so
 * these tests assert the footer's geometry rather than scroll behaviour:
 *  - the footer is rendered and visible
 *  - its bottom edge sits within a few pixels of the viewport bottom
 * This guards against regressions if a future change drops the sticky
 * positioning or the flex-column layout the footer depends on.
 */
test.describe('Pagination footer pinning', () => {
  test.beforeEach(async ({ page }) => {
    await loginAndSeed(page);
  });

  // The footer is sticky to the bottom of `.app-shell__content`. On
  // desktop that container fills the viewport. On mobile it leaves a 72px
  // padding-bottom gap for the fixed bottom-nav, so the footer's bottom
  // edge naturally sits 72px above the viewport bottom. We compare to the
  // scroll-container's bottom rather than the viewport's so the
  // assertion holds in both layouts.
  async function getStickyTarget(page: Page): Promise<number> {
    return page.evaluate(() => {
      const el = document.querySelector('main.app-shell__content') as HTMLElement | null;
      if (!el) throw new Error('missing app-shell__content');
      const rect = el.getBoundingClientRect();
      const styles = window.getComputedStyle(el);
      const paddingBottom = parseFloat(styles.paddingBottom) || 0;
      // `bottom: 0` on sticky positions the element flush against the
      // padding edge, i.e. (containerBottom - paddingBottom).
      return rect.bottom - paddingBottom;
    });
  }

  for (const path of ['/upcoming', '/logbook', '/venues', '/artists']) {
    test(`footer is pinned to viewport bottom on ${path}`, async ({ page }) => {
      await page.goto(path);
      // Scope to <main> — React streaming SSR briefly leaves a duplicate
      // copy of the page in a Suspense buffer (<div id="S:0">) before
      // hydration folds it back into the document tree. The buffered copy
      // is invisible (offsetParent === null) but still matches a bare
      // getByTestId, which trips Playwright's strict-mode assertion.
      const footer = page.getByRole('main').getByTestId('pagination-footer');
      await expect(footer).toBeVisible({ timeout: 10000 });

      const target = await getStickyTarget(page);
      const box = await footer.boundingBox();
      expect(box).not.toBeNull();
      const footerBottom = box!.y + box!.height;
      expect(footerBottom).toBeGreaterThan(target - 12);
      expect(footerBottom).toBeLessThanOrEqual(target + 1);
    });
  }

  test('shows footer stays at viewport bottom while scrolling the list', async ({ page }) => {
    await page.goto('/logbook');
    const footer = page.getByRole('main').getByTestId('pagination-footer');
    await expect(footer).toBeVisible({ timeout: 10000 });

    // Scroll the inner scroll container (.app-shell__content's child) by a
    // bit. Whether or not seed data overflows a page, the footer should not
    // move off the bottom of the scroll container.
    await page.evaluate(() => {
      const scroller = document.querySelector('.shows-list-table')?.parentElement;
      scroller?.scrollBy({ top: 200 });
    });
    await page.waitForTimeout(50);

    const target = await getStickyTarget(page);
    const box = await footer.boundingBox();
    expect(box).not.toBeNull();
    const footerBottom = box!.y + box!.height;
    expect(footerBottom).toBeGreaterThan(target - 12);
    expect(footerBottom).toBeLessThanOrEqual(target + 1);
  });
});
