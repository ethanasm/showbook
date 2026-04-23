import PgBoss from 'pg-boss';

// Job names
export const JOBS = {
  SHOWS_NIGHTLY: 'shows/nightly',
  SETLIST_RETRY: 'enrichment/setlist-retry',
  DISCOVER_INGEST: 'discover/ingest',
  NOTIFICATIONS_DIGEST: 'notifications/digest',
} as const;

// Stub handlers (actual logic implemented in Wave 4)
async function showsNightlyHandler(jobs: PgBoss.Job[]) {
  for (const job of jobs) {
    console.log(`[${JOBS.SHOWS_NIGHTLY}] Running nightly state transitions...`, job.id);
    // T25: actual implementation
  }
}

async function setlistRetryHandler(jobs: PgBoss.Job[]) {
  for (const job of jobs) {
    console.log(`[${JOBS.SETLIST_RETRY}] Running setlist enrichment retry...`, job.id);
    // T26: actual implementation
  }
}

async function discoverIngestHandler(jobs: PgBoss.Job[]) {
  for (const job of jobs) {
    console.log(`[${JOBS.DISCOVER_INGEST}] Running discovery ingestion...`, job.id);
    // T27: actual implementation
  }
}

async function notificationsDigestHandler(jobs: PgBoss.Job[]) {
  for (const job of jobs) {
    console.log(`[${JOBS.NOTIFICATIONS_DIGEST}] Running notification digest...`, job.id);
    // T28: actual implementation
  }
}

export async function registerAllJobs(boss: PgBoss): Promise<void> {
  // Register handlers
  await boss.work(JOBS.SHOWS_NIGHTLY, showsNightlyHandler);
  await boss.work(JOBS.SETLIST_RETRY, setlistRetryHandler);
  await boss.work(JOBS.DISCOVER_INGEST, discoverIngestHandler);
  await boss.work(JOBS.NOTIFICATIONS_DIGEST, notificationsDigestHandler);

  // Schedule cron jobs
  await boss.schedule(JOBS.SHOWS_NIGHTLY, '0 3 * * *', {}, { tz: 'America/New_York' });
  await boss.schedule(JOBS.SETLIST_RETRY, '0 4 * * *', {}, { tz: 'America/New_York' });
  await boss.schedule(JOBS.DISCOVER_INGEST, '0 2 * * *', {}, { tz: 'America/New_York' });
  // Notifications are per-user, handled differently in T28

  console.log('All jobs registered and scheduled');
}
