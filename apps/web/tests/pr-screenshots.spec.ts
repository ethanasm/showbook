import { test } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { loginAndSeedAsWorker } from './helpers/auth';
import { takeScreenshot } from './helpers/screenshots';

// Captures full-page screenshots of a route list supplied by the
// pr-screenshots skill. Routes come from the gitignored
// `apps/web/tests/.pr-screenshots.json` file the skill writes before
// invoking Playwright (and deletes after). Viewport is picked via the
// existing `--project=desktop-dark` / `--project=mobile` flags in
// `apps/web/playwright.config.ts`.

const ROUTES_FILE = path.join(__dirname, '.pr-screenshots.json');

function readRoutes(): string[] | null {
  if (!existsSync(ROUTES_FILE)) return null;
  const parsed = JSON.parse(readFileSync(ROUTES_FILE, 'utf8')) as {
    routes?: unknown;
  };
  if (
    !Array.isArray(parsed.routes) ||
    !parsed.routes.every((r): r is string => typeof r === 'string')
  ) {
    throw new Error(
      `pr-screenshots: ${ROUTES_FILE} must contain { "routes": string[] }`,
    );
  }
  return parsed.routes;
}

function slugify(route: string): string {
  const trimmed = route.replace(/^\//, '').replace(/\/$/, '');
  if (!trimmed) return 'home';
  return trimmed.replace(/[^a-zA-Z0-9]+/g, '-');
}

test('capture PR screenshots for diff-touched routes', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const routes = readRoutes();
  test.skip(routes === null, 'pr-screenshots skill did not stage a routes file');
  if (routes === null) return;
  const projectSlug = testInfo.project.name === 'mobile' ? 'mobile' : 'desktop';
  await loginAndSeedAsWorker(page);
  for (const route of routes) {
    await page.goto(route);
    await page.waitForLoadState('domcontentloaded');
    await takeScreenshot(page, `pr-${projectSlug}-${slugify(route)}`);
  }
});
