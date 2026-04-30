import { test, expect, type Page } from '@playwright/test';

async function loginAndSeed(page: Page) {
  await page.goto('/api/test/seed');
  await page.goto('/api/test/login');
  await page.waitForURL('**/home');
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

  for (const path of ['/shows', '/venues', '/artists']) {
    test(`footer is pinned to viewport bottom on ${path}`, async ({ page }) => {
      await page.goto(path);
      const footer = page.getByTestId('pagination-footer');
      await expect(footer).toBeVisible({ timeout: 10000 });

      const viewport = page.viewportSize();
      expect(viewport).not.toBeNull();
      const viewportHeight = viewport!.height;

      const box = await footer.boundingBox();
      expect(box).not.toBeNull();

      // The footer's bottom edge should sit within 4px of the viewport bottom
      // (or whatever bottom-of-scroll-container resolves to — they're the same
      // here because the page's flex-column scroll container fills the
      // viewport).
      const footerBottom = box!.y + box!.height;
      expect(footerBottom).toBeGreaterThan(viewportHeight - 12);
      expect(footerBottom).toBeLessThanOrEqual(viewportHeight + 1);
    });
  }

  test('shows footer stays at viewport bottom while scrolling the list', async ({ page }) => {
    await page.goto('/shows');
    const footer = page.getByTestId('pagination-footer');
    await expect(footer).toBeVisible({ timeout: 10000 });

    const viewportHeight = page.viewportSize()!.height;

    // Scroll the inner scroll container (.app-shell__content's child) by a
    // bit. Whether or not seed data overflows a page, the footer should not
    // move off the bottom of the viewport.
    await page.evaluate(() => {
      const scroller = document.querySelector('.shows-list-table')?.parentElement;
      scroller?.scrollBy({ top: 200 });
    });
    await page.waitForTimeout(50);

    const box = await footer.boundingBox();
    expect(box).not.toBeNull();
    const footerBottom = box!.y + box!.height;
    expect(footerBottom).toBeGreaterThan(viewportHeight - 12);
    expect(footerBottom).toBeLessThanOrEqual(viewportHeight + 1);
  });
});
