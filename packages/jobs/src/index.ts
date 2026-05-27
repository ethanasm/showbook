export { getBoss, startBoss, stopBoss, getBossState } from './boss';
export { registerAllJobs, JOBS } from './registry';
export {
  runDiscoverIngest,
  ingestVenue,
  ingestPerformer,
  ingestRegion,
} from './discover-ingest';
export { runDailyDigest } from './notifications';
export { runPruneOrphanCatalog } from './prune-orphan-catalog';
export { runBackfillShowCoverImages } from './backfill-show-cover-images';
export {
  runBackfillShowTicketUrls,
  type BackfillShowTicketUrlsSummary,
} from './backfill-show-ticket-urls';
export {
  runBackfillPerformerSpotifyIds,
  type BackfillPerformerSpotifyIdsSummary,
} from './backfill-performer-spotify-ids';
export { runHealthCheck, type HealthCheckSummary } from './health-check';
// Re-export from @showbook/api — the indexer lives in api so the tRPC
// routers can call it inline on setlist writes without a circular
// dependency. Kept as a re-export here so existing `@showbook/jobs`
// importers don't break.
export { runSongIndexRebuild } from '@showbook/api';
export {
  runDailyBacktest,
  rerunEvalForShow,
  evaluateShow,
  summarizeRun,
  type RunDailyBacktestInput,
  type RunDailyBacktestResult,
  type PerShowEvalRow,
  type PerStyleSummary,
  type EvalStyle,
} from './prediction-eval';
