import { defineConfig } from '@playwright/test';

const customChromium = process.env.PLAYWRIGHT_CHROMIUM_PATH;
const port = Number(process.env.PLAYWRIGHT_PORT ?? 3003);

// Local runs use `next dev --experimental-https` for HMR + iteration.
// CI runs against a built app via `next start` (HTTP) — dev-mode on-demand
// compilation makes pages take 30+ seconds on first hit on the CI runner,
// causing per-test timeouts. The build is produced in a separate CI step.
const isCI = process.env.CI === 'true';
const protocol = isCI ? 'http' : 'https';

export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  // All tests share a single test user + DB. Run serially so /api/test/seed
  // calls in one test don't wipe data another test is mid-way through using.
  workers: 1,
  use: {
    baseURL: `${protocol}://localhost:${port}`,
    ignoreHTTPSErrors: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    ...(customChromium
      ? { launchOptions: { executablePath: customChromium } }
      : {}),
  },
  projects: [
    { name: 'desktop-dark', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 } } },
  ],
  webServer: {
    command: isCI
      ? 'MEDIA_STORAGE_MODE=local pnpm start:e2e'
      : 'MEDIA_STORAGE_MODE=local pnpm dev:e2e',
    port,
    reuseExistingServer: false,
    // The first request after `next start` boots needs ~5–10s in CI, so
    // give the server room before Playwright opens its first page.
    timeout: 120_000,
  },
});
