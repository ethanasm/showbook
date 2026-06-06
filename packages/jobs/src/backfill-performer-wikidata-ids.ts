// `load-env-local` is a no-op when no .env.local is present (the prod
// container case), so it's safe to import unconditionally even when this
// module is loaded from the registry inside Next.js. Local CLI invocations
// still get their .env.local merged.
import './load-env-local';

import { db, performers } from '@showbook/db';
import { and, isNull, asc } from 'drizzle-orm';
import { resolvePerformerWikidataId } from '@showbook/api';
import { child, flushObservability } from '@showbook/observability';

const log = child({ component: 'jobs.backfill-performer-wikidata-ids' });

export interface BackfillPerformerWikidataIdsSummary {
  total: number;
  updated: number;
  missing: number;
  skipped: number;
  failed: number;
}

/**
 * Backfill `performers.wikidata_qid` for rows that don't yet have one and
 * have no Ticketmaster id. Mirrors `backfill-performer-spotify-ids`.
 *
 * Scope (`ticketmaster_attraction_id IS NULL`): theatre cast and other
 * manual non-TM performers are the population Wikidata is the only
 * enrichment source for. TM-backed performers already carry an image and
 * (via externalLinks) an MBID, so running a Wikidata name-search across
 * the whole concert corpus would be wasted calls and a needless mismatch
 * risk. Stalest-first by `created_at` so a rate-limited run still cycles
 * the whole non-TM corpus over successive nights.
 *
 * Why this exists: every ingest path funnels through
 * `matchOrCreatePerformer`, which fires `resolvePerformerWikidataId` as a
 * fire-and-forget hook on every new non-TM row. This cron is the
 * steady-state safety net for hook failures and the catch-up path for the
 * backlog of name-only cast created before the hook landed.
 *
 * Run via pg-boss schedule or CLI:
 *   `pnpm --filter @showbook/jobs exec tsx src/backfill-performer-wikidata-ids.ts`
 */
export async function runBackfillPerformerWikidataIds(): Promise<BackfillPerformerWikidataIdsSummary> {
  const rows = await db
    .select({ id: performers.id, name: performers.name })
    .from(performers)
    .where(
      and(
        isNull(performers.wikidataQid),
        isNull(performers.ticketmasterAttractionId),
      ),
    )
    .orderBy(asc(performers.createdAt));

  let updated = 0;
  let missing = 0;
  let skipped = 0;
  let failed = 0;

  for (const performer of rows) {
    const outcome = await resolvePerformerWikidataId(performer.id, performer.name);
    switch (outcome.kind) {
      case 'updated':
        updated++;
        break;
      case 'no_match':
        missing++;
        break;
      case 'skipped':
        skipped++;
        break;
      case 'failed':
        failed++;
        break;
    }
  }

  log.info(
    {
      event: 'performer.wikidata_qid.done',
      total: rows.length,
      updated,
      missing,
      skipped,
      failed,
    },
    'Backfill complete',
  );

  return { total: rows.length, updated, missing, skipped, failed };
}

// CLI entry point: run only when invoked directly, not when imported by
// the registry.
const isMain =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1] !== undefined &&
  import.meta.url === `file://${process.argv[1]}`;

if (isMain) {
  runBackfillPerformerWikidataIds()
    .then(async () => {
      await flushObservability();
      process.exit(0);
    })
    .catch(async (err) => {
      log.error({ err, event: 'performer.wikidata_qid.fatal' }, 'Backfill failed');
      await flushObservability();
      process.exit(1);
    });
}
