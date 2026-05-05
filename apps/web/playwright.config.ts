import { defineConfig } from '@playwright/test';

const customChromium = process.env.PLAYWRIGHT_CHROMIUM_PATH;
const port = Number(process.env.PLAYWRIGHT_PORT ?? 3003);

// Local runs use `next dev --experimental-https` for HMR + iteration.
// CI runs against a built app via `next start` (HTTP) — dev-mode on-demand
// compilation makes pages take 30+ seconds on first hit on the CI runner,
// causing per-test timeouts. The build is produced in a separate CI step.
const isCI = process.env.CI === 'true';
const protocol = isCI ? 'http' : 'https';
// Workers > 1 are safe: each worker partitions on its own
// `e2e-w<index>@showbook.dev` user via /api/test/{login,seed}?worker=N.
// Shared (read-only-after-setup) data — venues, performers,
// announcements — is seeded once by `tests/global.setup.ts`.
const workers = Number(process.env.PLAYWRIGHT_WORKERS ?? 4);

const sharedUse = {
  baseURL: `${protocol}://localhost:${port}`,
  ignoreHTTPSErrors: true,
  screenshot: 'only-on-failure' as const,
  trace: 'retain-on-failure' as const,
  ...(customChromium
    ? { launchOptions: { executablePath: customChromium } }
    : {}),
};

export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  workers,
  // CI retries absorb timing flakes (server cold-start, network blips on
  // shared GitHub runners). Local runs keep retries off so flakes surface.
  retries: isCI ? 2 : 0,
  // CI: custom progress reporter prints `Executing X of Y tests (Z failed)`
  // after each test; HTML report is kept for the artifact upload step.
  // Local: default `list` reporter for full per-test detail.
  reporter: isCI
    ? [
        ['./tests/reporters/progress-reporter.ts'],
        ['html', { open: 'never' }],
      ]
    : 'list',
  use: sharedUse,
  projects: [
    {
      name: 'setup',
      testMatch: /global\.setup\.ts$/,
      use: sharedUse,
    },
    {
      name: 'desktop-dark',
      use: { ...sharedUse, viewport: { width: 1440, height: 900 } },
      dependencies: ['setup'],
    },
    {
      name: 'mobile',
      use: { ...sharedUse, viewport: { width: 390, height: 844 } },
      dependencies: ['setup'],
    },
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
