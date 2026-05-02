import { test as setup, expect } from '@playwright/test';

// One-shot setup that runs before every other project. Calls the
// unworked /api/test/seed once so the canonical (announcements +
// shared venues + performers) data exists exactly once. Per-worker
// seeds in the test suites are user-scoped only and never touch
// announcements.
setup('reset and seed shared e2e data', async ({ request }) => {
  const res = await request.get('/api/test/seed');
  expect(res.ok(), `seed failed: ${res.status()}`).toBeTruthy();
});
