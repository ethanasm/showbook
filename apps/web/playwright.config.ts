import { defineConfig } from '@playwright/test';

const customChromium = process.env.PLAYWRIGHT_CHROMIUM_PATH;
const port = Number(process.env.PLAYWRIGHT_PORT ?? 3002);

export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  // All tests share a single test user + DB. Run serially so /api/test/seed
  // calls in one test don't wipe data another test is mid-way through using.
  workers: 1,
  use: {
    baseURL: `https://localhost:${port}`,
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
    command: 'MEDIA_STORAGE_MODE=local pnpm dev:e2e',
    port,
    reuseExistingServer: false,
  },
});
