import { defineConfig } from '@playwright/test';

// Standalone Playwright config for the brand-preview spec — no Next.js
// dev server, no Postgres, no global setup. Used only when capturing
// brand screenshots locally (`RUN_BRAND_SCREENSHOTS=1`).

const customChromium = process.env.PLAYWRIGHT_CHROMIUM_PATH;

export default defineConfig({
  testDir: __dirname,
  testMatch: /brand-preview\.spec\.ts$/,
  outputDir: __dirname + '/.brand-results',
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    deviceScaleFactor: 2,
    ...(customChromium
      ? { launchOptions: { executablePath: customChromium } }
      : {}),
  },
});
