/**
 * Standalone visual capture for the new ShowbookMark in the web app
 * sidebar + sign-in panel. Doesn't talk to Postgres — assembles a
 * page-shape preview inline using the real `design-system.css` rules
 * and the actual `ShowbookMark` SVG. Opt-in via
 * `RUN_BRAND_SCREENSHOTS=1`.
 *
 * Run with the lightweight standalone config below so we don't need the
 * full Next dev server + e2e DB. See `tests/brand-preview.config.ts`.
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import { test, expect } from '@playwright/test';

const RUN = process.env.RUN_BRAND_SCREENSHOTS === '1';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const DESIGN_SYSTEM_CSS = path.join(
  REPO_ROOT,
  'apps/web/components/design-system/design-system.css',
);
const SIGNIN_CSS = path.join(REPO_ROOT, 'apps/web/app/(auth)/signin/signin.css');
const GLOBALS_CSS = path.join(REPO_ROOT, 'apps/web/app/globals.css');
const MARK_SVG = path.join(REPO_ROOT, 'apps/web/public/showbook-mark.svg');

async function loadCss(): Promise<string> {
  const [ds, si, gl] = await Promise.all([
    fs.readFile(DESIGN_SYSTEM_CSS, 'utf-8'),
    fs.readFile(SIGNIN_CSS, 'utf-8'),
    fs.readFile(GLOBALS_CSS, 'utf-8'),
  ]);
  return `${gl}\n${ds}\n${si}`;
}

async function loadMark(): Promise<string> {
  return fs.readFile(MARK_SVG, 'utf-8');
}

test.describe('web brand placement', () => {
  test.skip(!RUN, 'set RUN_BRAND_SCREENSHOTS=1 to capture');

  test('sidebar header (dark)', async ({ page }) => {
    const css = await loadCss();
    const mark = await loadMark();
    const sidebarMark = mark
      .replace('width="64"', 'width="26"')
      .replace('height="64"', 'height="26"');
    await page.setViewportSize({ width: 320, height: 200 });
    await page.setContent(
      `<!doctype html><html data-theme="dark"><head><style>${css}
       body { margin: 0; background: var(--bg); padding: 24px; }
       .frame { width: 260px; }
       </style></head><body><div class="frame">
         <div class="sidebar__header">
           <button class="sidebar__logo" type="button">
             <span class="sidebar__logo-mark">${sidebarMark}</span>
             <span class="sidebar__logo-text">showbook</span>
           </button>
           <span class="sidebar__version">v2 · 2026.04</span>
         </div>
       </div></body></html>`,
    );
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.sidebar__logo-text')).toBeVisible();
    await page.screenshot({
      path: path.join(__dirname, '..', 'brand-screenshots', 'web-sidebar-dark.png'),
      omitBackground: false,
      fullPage: false,
    });
  });

  test('signin panel (dark)', async ({ page }) => {
    const css = await loadCss();
    const mark = await loadMark();
    const brandMark = mark
      .replace('width="64"', 'width="36"')
      .replace('height="64"', 'height="36"');
    await page.setViewportSize({ width: 600, height: 540 });
    await page.setContent(
      `<!doctype html><html data-theme="dark"><head><style>${css}
       body { margin: 0; background: var(--bg); padding: 56px 64px; }
       </style></head><body>
         <div class="signin__brand">
           <span class="signin__brand-mark">${brandMark}</span>
           <span class="signin__brand-text">showbook</span>
         </div>
         <div class="signin__hero" style="margin-top:28px;max-width:460px;">
           <span class="eyebrow">Personal Live-Show Tracker</span>
           <h1 class="signin__title">Every show, <em class="gradient-emphasis">worth&nbsp;remembering.</em></h1>
           <p class="signin__subtitle">A private logbook for the concerts, plays, sets, and festivals you've seen — and the ones still ahead.</p>
         </div>
       </body></html>`,
    );
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.signin__brand-text')).toBeVisible();
    await page.screenshot({
      path: path.join(__dirname, '..', 'brand-screenshots', 'web-signin-dark.png'),
      fullPage: false,
    });
  });
});
