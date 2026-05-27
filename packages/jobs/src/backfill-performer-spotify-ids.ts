// `load-env-local` is a no-op when no .env.local is present (the prod
// container case), so it's safe to import unconditionally even when this
// module is loaded from the registry inside Next.js. Local CLI invocations
// still get their .env.local merged.
import './load-env-local';

import { db, performers } from '@showbook/db';
import { isNull } from 'drizzle-orm';
import { resolvePerformerSpotifyId } from '@showbook/api';
import { child, flushObservability } from '@showbook/observability';

const log = child({ component: 'jobs.backfill-performer-spotify-ids' });

export interface BackfillPerformerSpotifyIdsSummary {
  total: number;
  updated: number;
  missing: number;
  skipped: number;
  failed: number;
}

/**
 * Backfill `performers.spotify_artist_id` for rows that don't yet have
 * one. Mirrors `backfill-performer-mbids` and
 * `backfill-performer-ticketmaster-ids`.
 *
 * Why this exists: every ingest path (Add Show form/chat, scrapers,
 * discover ingest, festival lineup picker, Spotify follow import)
 * funnels through `matchOrCreatePerformer`, which now fires
 * `resolvePerformerSpotifyId` as a fire-and-forget hook on every new
 * row. This cron is the steady-state safety net for hook failures (a
 * Spotify 5xx during a busy ingest run) and the catch-up path for the
 * pre-existing backlog created before the hook landed.
 *
 * Strategy: for every performer with `spotify_artist_id IS NULL`, call
 * Spotify `/v1/search?type=artist&q={name}` via the app-level
 * `client_credentials` token. Race-guarded UPDATE matches the MBID /
 * TM-id backfill pattern.
 *
 * Rate-limited by `spotifyFetch` (handles 429 with Retry-After).
 *
 * Scheduled at 06:30 ET — after the TM-id backfill (06:00 ET) so any
 * TM-derived MBIDs are in place but well before the morning digest at
 * 08:00 ET. Run via pg-boss schedule or CLI:
 *   `pnpm --filter @showbook/jobs exec tsx src/backfill-performer-spotify-ids.ts`
 */
export async function runBackfillPerformerSpotifyIds(): Promise<BackfillPerformerSpotifyIdsSummary> {
  const rows = await db
    .select({ id: performers.id, name: performers.name })
    .from(performers)
    .where(isNull(performers.spotifyArtistId));

  let updated = 0;
  let missing = 0;
  let skipped = 0;
  let failed = 0;

  for (const performer of rows) {
    const outcome = await resolvePerformerSpotifyId(
      performer.id,
      performer.name,
    );
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
      event: 'performer.spotify_id.done',
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

// CLI entry point: run only when invoked directly (e.g. `tsx
// src/backfill-performer-spotify-ids.ts`), not when imported by the registry.
const isMain =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1] !== undefined &&
  import.meta.url === `file://${process.argv[1]}`;

if (isMain) {
  runBackfillPerformerSpotifyIds()
    .then(async () => {
      await flushObservability();
      process.exit(0);
    })
    .catch(async (err) => {
      log.error({ err, event: 'performer.spotify_id.fatal' }, 'Backfill failed');
      await flushObservability();
      process.exit(1);
    });
}
