import { test, type Page } from '@playwright/test';

// Per-worker user partitioning. Each Playwright worker gets its own
// `e2e-w<index>@showbook.dev` user so workers > 1 don't trample each
// other's user-scoped data (shows, follows, regions, prefs). Shared
// data (venues, performers, announcements) is seeded once by
// tests/global.setup.ts.

export function workerIndex(): number {
  return test.info().parallelIndex;
}

export async function loginAsWorker(
  page: Page,
  opts: { email?: string } = {},
) {
  const idx = workerIndex();
  const url = opts.email
    ? `/api/test/login?email=${encodeURIComponent(opts.email)}`
    : `/api/test/login?worker=${idx}`;
  await page.goto(url);
  await page.waitForURL('**/home');
}

export async function seedForWorker(page: Page) {
  const idx = workerIndex();
  const res = await page.request.get(`/api/test/seed?worker=${idx}`);
  if (!res.ok()) {
    throw new Error(`seed failed (${res.status()}): ${await res.text()}`);
  }
}

export async function loginAndSeedAsWorker(page: Page) {
  await seedForWorker(page);
  await loginAsWorker(page);
}

// For tests that need an empty (no-shows) user. Each worker gets its
// own empty user so they don't collide with seeded ones.
export async function loginAsEmptyWorker(page: Page) {
  const idx = workerIndex();
  await loginAsWorker(page, { email: `e2e-empty-w${idx}@showbook.dev` });
}

// Look up a show id for the current worker's user.
export async function workerShowId(
  page: Page,
  query: Record<string, string>,
): Promise<string | null> {
  const idx = workerIndex();
  const params = new URLSearchParams({ ...query, worker: String(idx) });
  const res = await page.request.get(`/api/test/show-id?${params.toString()}`);
  if (!res.ok()) return null;
  const body = (await res.json()) as { id: string | null };
  return body.id ?? null;
}
