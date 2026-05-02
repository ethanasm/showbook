// Test-route helpers for per-worker user partitioning. Playwright workers
// pass ?worker=<index> so that parallel runs don't trample each other's
// user-scoped data. Without `worker`, the routes use the original
// `test@showbook.dev` user — preserves the dev / single-process flow.

const DEFAULT_EMAIL = 'test@showbook.dev';
const DEFAULT_NAME = 'Test User';

export function workerEmail(rawWorker: string | null): string {
  if (rawWorker == null) return DEFAULT_EMAIL;
  const idx = Number.parseInt(rawWorker, 10);
  if (!Number.isFinite(idx) || idx < 0) return DEFAULT_EMAIL;
  return `e2e-w${idx}@showbook.dev`;
}

export function workerName(rawWorker: string | null): string {
  if (rawWorker == null) return DEFAULT_NAME;
  const idx = Number.parseInt(rawWorker, 10);
  if (!Number.isFinite(idx) || idx < 0) return DEFAULT_NAME;
  return `Worker ${idx}`;
}
