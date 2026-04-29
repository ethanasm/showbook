import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  // All tests share a single test user + DB. Run serially so /api/test/seed
  // calls in one test don't wipe data another test is mid-way through using.
  workers: 1,
  use: {
    baseURL: 'https://localhost:3001',
    ignoreHTTPSErrors: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop-dark', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 } } },
  ],
  webServer: {
    command: 'pnpm dev',
    port: 3001,
    reuseExistingServer: true,
  },
});
