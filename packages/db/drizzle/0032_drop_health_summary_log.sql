-- Drop the dedup table from migration 0031. We added it as a defence
-- against duplicate `runHealthCheck` invocations causing duplicate
-- emails, on the theory that the duplicates had to be defended at the
-- email-send layer. The actual root cause turned out to be the
-- send-only PgBoss instance in `packages/api/src/job-queue.ts`
-- starting its own timekeeper and racing the primary boss's cron
-- monitor — fixed by passing `schedule: false, supervise: false` on
-- that instance. With that fix the table never gets a second
-- conflicting INSERT, so it's dead weight; removing it.

DROP TABLE IF EXISTS "health_summary_log";
