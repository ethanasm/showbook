/**
 * Standalone visual capture for the `ShowbookMark` brand mark in the web
 * app sidebar, sign-in panel, and public-shell header. Doesn't talk to
 * Postgres — assembles a page-shape preview inline using the real
 * `design-system.css` / `signin.css` / `globals.css` rules and the actual
 * `showbook-mark.svg` artwork. Opt-in via `RUN_BRAND_SCREENSHOTS=1`.
 *
 * The BEFORE cases render the pre-fix mark (a 64×64 viewBox that was
 * ~50% transparent padding, with an oversized "S" that overflowed the
 * ticket); the AFTER cases render the corrected mark. The pair is the
 * visual record of the logo-alignment fix.
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

// AFTER: the corrected mark — viewBox cropped tight to the rotated
// ticket (~1.38:1), so `size` is the real rendered height.
const ASPECT = 47 / 34;
function afterMark(mark: string, height: number): string {
  const width = (height * ASPECT).toFixed(2);
  return mark
    .replace('width="47"', `width="${width}"`)
    .replace('height="34"', `height="${height}"`);
}

// BEFORE: the pre-fix mark — a square 64×64 viewBox (half of it empty
// padding) with a font-size 26 "S" that spilled past the ticket edge.
const BEFORE_MARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Showbook">
  <g transform="rotate(-6 32 32)">
    <path fill="#FFD166" fill-rule="evenodd" d="M 14.5 18 H 49.5 A 3.5 3.5 0 0 1 53 21.5 V 30 A 3.75 3.75 0 0 0 49.25 33.75 A 3.75 3.75 0 0 0 53 37.5 V 42.5 A 3.5 3.5 0 0 1 49.5 46 H 14.5 A 3.5 3.5 0 0 1 11 42.5 V 37.5 A 3.75 3.75 0 0 0 14.75 33.75 A 3.75 3.75 0 0 0 11 30 V 21.5 A 3.5 3.5 0 0 1 14.5 18 Z"/>
    <text x="32" y="41.5" font-family="-apple-system, BlinkMacSystemFont, 'Inter', 'Helvetica Neue', Arial, sans-serif" font-weight="900" font-size="26" fill="#0C0C0C" text-anchor="middle" letter-spacing="-1">S</text>
  </g>
</svg>`;
function beforeMark(size: number): string {
  return BEFORE_MARK.replace('<svg ', `<svg width="${size}" height="${size}" `);
}

// The pre-fix sidebar header baseline-aligned the version tag (which
// pinned it to the SVG's bottom edge) and nudged the mark down 1px.
const BEFORE_CSS = `
  .sidebar__header { align-items: baseline; }
  .sidebar__logo-mark { margin-top: 1px; }
`;

function screenshotPath(name: string): string {
  return path.join(__dirname, '..', 'brand-screenshots', `${name}.png`);
}

test.describe('web brand placement', () => {
  test.skip(!RUN, 'set RUN_BRAND_SCREENSHOTS=1 to capture');

  // ---- Sidebar header ------------------------------------------------

  test('sidebar header (after)', async ({ page }) => {
    const css = await loadCss();
    const mark = afterMark(await loadMark(), 20);
    await page.setViewportSize({ width: 270, height: 74 });
    await page.setContent(
      `<!doctype html><html data-theme="dark"><head><style>${css}
       body { margin: 0; background: var(--bg); padding: 14px; }
       .frame { width: 240px; }
       </style></head><body><div class="frame">
         <div class="sidebar__header">
           <button class="sidebar__logo" type="button">
             <span class="sidebar__logo-mark">${mark}</span>
             <span class="sidebar__logo-text">showbook</span>
           </button>
           <span class="sidebar__version">v2 · 2026.04</span>
         </div>
       </div></body></html>`,
    );
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.sidebar__logo-text')).toBeVisible();
    await page.screenshot({ path: screenshotPath('web-sidebar-after'), fullPage: false });
  });

  test('sidebar header (before)', async ({ page }) => {
    const css = await loadCss();
    await page.setViewportSize({ width: 270, height: 74 });
    await page.setContent(
      `<!doctype html><html data-theme="dark"><head><style>${css}${BEFORE_CSS}
       body { margin: 0; background: var(--bg); padding: 14px; }
       .frame { width: 240px; }
       </style></head><body><div class="frame">
         <div class="sidebar__header">
           <button class="sidebar__logo" type="button">
             <span class="sidebar__logo-mark">${beforeMark(26)}</span>
             <span class="sidebar__logo-text">showbook</span>
           </button>
           <span class="sidebar__version">v2 · 2026.04</span>
         </div>
       </div></body></html>`,
    );
    await page.waitForLoadState('domcontentloaded');
    await page.screenshot({ path: screenshotPath('web-sidebar-before'), fullPage: false });
  });

  // ---- Sign-in panel -------------------------------------------------

  test('signin panel (after)', async ({ page }) => {
    const css = await loadCss();
    const mark = afterMark(await loadMark(), 26);
    await page.setViewportSize({ width: 210, height: 86 });
    await page.setContent(
      `<!doctype html><html data-theme="dark"><head><style>${css}
       body { margin: 0; background: var(--bg); padding: 22px; }
       </style></head><body>
         <div class="signin__brand">
           <span class="signin__brand-mark">${mark}</span>
           <span class="signin__brand-text">showbook</span>
         </div>
       </body></html>`,
    );
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.signin__brand-text')).toBeVisible();
    await page.screenshot({ path: screenshotPath('web-signin-after'), fullPage: false });
  });

  test('signin panel (before)', async ({ page }) => {
    const css = await loadCss();
    await page.setViewportSize({ width: 210, height: 86 });
    await page.setContent(
      `<!doctype html><html data-theme="dark"><head><style>${css}
       body { margin: 0; background: var(--bg); padding: 22px; }
       </style></head><body>
         <div class="signin__brand">
           <span class="signin__brand-mark">${beforeMark(36)}</span>
           <span class="signin__brand-text">showbook</span>
         </div>
       </body></html>`,
    );
    await page.waitForLoadState('domcontentloaded');
    await page.screenshot({ path: screenshotPath('web-signin-before'), fullPage: false });
  });

  // ---- Public-shell header ------------------------------------------

  test('public shell header (after)', async ({ page }) => {
    const css = await loadCss();
    const mark = afterMark(await loadMark(), 18);
    await page.setViewportSize({ width: 190, height: 72 });
    await page.setContent(
      `<!doctype html><html data-theme="dark"><head><style>${css}
       body { margin: 0; background: var(--bg); }
       </style></head><body>
         <header class="public-shell__header">
           <a class="public-shell__brand" href="#">${mark}<span>showbook</span></a>
         </header>
       </body></html>`,
    );
    await page.waitForLoadState('domcontentloaded');
    await page.screenshot({ path: screenshotPath('web-public-after'), fullPage: false });
  });

  test('public shell header (before)', async ({ page }) => {
    const css = await loadCss();
    await page.setViewportSize({ width: 190, height: 72 });
    await page.setContent(
      `<!doctype html><html data-theme="dark"><head><style>${css}
       body { margin: 0; background: var(--bg); }
       </style></head><body>
         <header class="public-shell__header">
           <a class="public-shell__brand" href="#">${beforeMark(28)}<span>showbook</span></a>
         </header>
       </body></html>`,
    );
    await page.waitForLoadState('domcontentloaded');
    await page.screenshot({ path: screenshotPath('web-public-before'), fullPage: false });
  });
});
