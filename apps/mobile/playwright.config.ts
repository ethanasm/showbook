import { defineConfig } from '@playwright/test';

// Headless web verification config for the Expo mobile app.
//
// The web target is a parity-on-import bundle (see web-shims/README.md):
// native-only modules are swapped out at Metro resolve time, the JS is
// exported once via `expo export --platform web`, and Playwright drives
// the static bundle in Chromium. The goal is fast layout / state /
// navigation checks in the sandbox — NOT full functional parity with
// the native app.
//
// Real mobile e2e still runs in `.github/workflows/mobile-e2e.yml`
// (Android emulator + Maestro on the self-hosted runner). The web
// loop is the iteration tier underneath that gate.

const port = Number(process.env.MOBILE_WEB_PORT ?? 4319);
const customChromium = process.env.PLAYWRIGHT_CHROMIUM_PATH;

export default defineConfig({
  testDir: './web-tests',
  outputDir: './web-tests/.results',
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    // Mobile viewport — match the native dev experience and let
    // responsive-layout regressions surface here rather than only on a
    // real device.
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    ...(customChromium ? { launchOptions: { executablePath: customChromium } } : {}),
  },
  webServer: {
    // The web bundle must be built first via `pnpm mobile:web:build`.
    // We serve the static export here so each test run gets a deterministic
    // (non-HMR) bundle — Metro dev mode is too flaky for headless runs.
    command: `node ${__dirname}/web-tests/serve.mjs dist-web ${port}`,
    cwd: __dirname,
    port,
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 30_000,
  },
});
