import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * One row per ET calendar day on which the morning health-summary email
 * was claimed by a run of `runHealthCheck`. The `et_date` PK is the
 * dedup boundary: the orchestrator does an
 * `INSERT … ON CONFLICT DO NOTHING RETURNING et_date` before calling
 * Resend, and only the run that successfully inserts proceeds with the
 * send. Concurrent runs (the cron firing twice, a pg-boss replay, two
 * boss instances racing) lose the insert race and skip cleanly.
 *
 * This is the source of truth for "we sent today's summary". The
 * Resend idempotency key on the actual `emails.send` call stays as
 * defence in depth — under tight concurrency Resend has shipped both
 * sides of an idempotent pair, which is exactly the duplicate the PK
 * here is designed to prevent.
 */
export const healthSummaryLog = pgTable('health_summary_log', {
  etDate: text('et_date').primaryKey(),
  sentAt: timestamp('sent_at', { withTimezone: true }).defaultNow().notNull(),
});
