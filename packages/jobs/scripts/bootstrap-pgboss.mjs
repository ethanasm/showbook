#!/usr/bin/env node
/**
 * One-shot pg-boss schema bootstrap. Run after `db:reset:e2e` so the
 * region-ingest-status integration test (which queries pgboss.job
 * directly) can run.
 *
 * pg-boss creates its schema on the first `boss.start()`; we do that
 * once and stop. The schema is owned by pg-boss; subsequent runs
 * (re-using a DB) are no-ops.
 */
import PgBoss from 'pg-boss';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const boss = new PgBoss({ connectionString: url });
boss.on('error', (err) => {
  // Surfaces internal errors that would otherwise be swallowed.
  console.error('pg-boss error:', err);
});

await boss.start();
await boss.stop();
console.log('pg-boss schema bootstrapped on', url);
