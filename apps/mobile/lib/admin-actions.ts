/**
 * Pure presentation helpers for the Me-tab admin section
 * (`components/AdminSection.tsx`).
 *
 * The admin tRPC mutations return small typed result objects; these
 * helpers turn them into the one-line summary shown in the success
 * toast after an action runs. They live here — not inline in the
 * component — so the wording is unit-tested: the component itself is
 * outside the `apps/mobile/lib/**` coverage gate, these functions are
 * inside it.
 *
 * No React, no react-native imports: safe to load in node:test.
 */

/**
 * Toast summary for an admin action that enqueues a pg-boss job.
 *
 * pg-boss singleton queues dedup an identical pending job, in which
 * case the server returns a null `jobId`. Surface that case distinctly
 * so the operator doesn't assume a fresh run was kicked off.
 */
export function formatJobEnqueued(jobId: string | null | undefined): string {
  return jobId
    ? 'Job enqueued — it runs in the background'
    : 'Already queued — no new job was created';
}

/**
 * Toast summary for a venue backfill that reports per-row counts.
 * `verb` is the past-tense success verb for matched rows, e.g.
 * "Geocoded" or "Matched".
 */
export function formatVenueBackfill(
  verb: string,
  succeeded: number,
  failed: number,
  total: number,
): string {
  if (total === 0) {
    return 'Nothing to backfill — every venue is already complete';
  }
  const parts = [`${verb} ${succeeded}`];
  if (failed > 0) parts.push(`${failed} failed`);
  parts.push(`${total} total`);
  return parts.join(' · ');
}

/** Toast summary for the "Run setlist enrichment" action. */
export function formatSetlistRetry(
  queued: number,
  jobId: string | null | undefined,
): string {
  const head =
    queued === 0
      ? 'No new shows needed queueing'
      : `Queued ${queued} ${queued === 1 ? 'show' : 'shows'}`;
  return jobId ? `${head} · retry job started` : head;
}

/** Toast summary for the per-performer "Refresh corpus" action. */
export function formatCorpusFill(
  performerName: string,
  hasMbid: boolean,
): string {
  const head = `Corpus fill enqueued for ${performerName}`;
  return hasMbid
    ? head
    : `${head} — no MBID on file, the job will short-circuit`;
}
