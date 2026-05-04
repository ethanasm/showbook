import { test } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { loginAndSeedAsWorker, loginAsEmptyWorker } from './helpers/auth';
import { takeScreenshot } from './helpers/screenshots';

// Captures full-page screenshots of a route list supplied by the
// pr-screenshots skill. Routes come from the gitignored
// `apps/web/tests/.pr-screenshots.json` file the skill writes before
// invoking Playwright (and deletes after). Viewport is picked via the
// existing `--project=desktop-dark` / `--project=mobile` flags in
// `apps/web/playwright.config.ts`.
//
// Optional `empty: true` in the JSON switches the worker login from the
// seeded fixture user to the empty-shows fixture user, which is the only
// way to capture brand-new-user empty states (Home Get Started hub,
// /shows-/artists-/venues "no rows yet" surfaces).

const ROUTES_FILE = path.join(__dirname, '.pr-screenshots.json');

interface RoutesConfig {
  routes: string[];
  empty?: boolean;
}

function readRoutes(): RoutesConfig | null {
  if (!existsSync(ROUTES_FILE)) return null;
  const parsed = JSON.parse(readFileSync(ROUTES_FILE, 'utf8')) as {
    routes?: unknown;
    empty?: unknown;
  };
  if (
    !Array.isArray(parsed.routes) ||
    !parsed.routes.every((r): r is string => typeof r === 'string')
  ) {
    throw new Error(
      `pr-screenshots: ${ROUTES_FILE} must contain { "routes": string[] }`,
    );
  }
  return {
    routes: parsed.routes,
    empty: parsed.empty === true,
  };
}

function slugify(route: string): string {
  const trimmed = route.replace(/^\//, '').replace(/\/$/, '');
  if (!trimmed) return 'home';
  return trimmed.replace(/[^a-zA-Z0-9]+/g, '-');
}

test('capture PR screenshots for diff-touched routes', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const config = readRoutes();
  test.skip(config === null, 'pr-screenshots skill did not stage a routes file');
  if (config === null) return;
  const projectSlug = testInfo.project.name === 'mobile' ? 'mobile' : 'desktop';
  if (config.empty) {
    await loginAsEmptyWorker(page);
  } else {
    await loginAndSeedAsWorker(page);
  }
  for (const route of config.routes) {
    await page.goto(route);
    await page.waitForLoadState('domcontentloaded');
    await takeScreenshot(page, `pr-${projectSlug}-${slugify(route)}`);
  }
});
