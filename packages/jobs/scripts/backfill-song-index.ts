#!/usr/bin/env tsx
/**
 * One-time backfill — walks every `shows.setlists` + every `tour_setlists`
 * row in the database and re-builds the denormalized
 * `setlist_song_appearances` index plus the `songs` catalogue. Safe to
 * re-run: the indexer wipes prior rows and re-inserts from scratch.
 *
 * Usage (from the repo root):
 *
 *   pnpm --filter @showbook/jobs tsx scripts/backfill-song-index.ts
 *
 * Per SI-20 (resolved option C): the script is idempotent and a full
 * walk over a self-hosted Showbook's dataset (≤ thousands of shows)
 * completes inside ~20 minutes. No `--since-show-id` resume flag is
 * shipped; if a future at-scale deployment needs one, that flag is
 * cheap to add at that point.
 */

import { runSongIndexRebuild } from '@showbook/api';

async function main(): Promise<void> {
  const startedAt = Date.now();
  console.log('[backfill-song-index] starting full DB rebuild…');
  const result = await runSongIndexRebuild({});
  const durationMs = Date.now() - startedAt;
  console.log(
    `[backfill-song-index] done in ${(durationMs / 1000).toFixed(1)}s`,
    JSON.stringify(result, null, 2),
  );
  process.exit(0);
}

main().catch((err) => {
  console.error('[backfill-song-index] failed', err);
  process.exit(1);
});
