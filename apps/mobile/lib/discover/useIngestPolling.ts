/**
 * `useIngestPolling` — drives the auto-refresh behaviour for the mobile
 * Discover screen while a background ingest job is in flight.
 *
 * The Regions tab (and to a lesser extent Venues / Artists) was showing a
 * tiny count on cold launch — "8 venues" — that jumped to the real number
 * — "800 venues" — only after the user pulled to refresh. The root cause
 * is the `enqueueIngestRegion` pg-boss job: when a user adds a region,
 * the announcements stream in over the next few minutes as the worker
 * pages Ticketmaster, and the `discover.nearbyFeed` query reads "rows in
 * the DB right now" rather than a total. Web side already polls
 * `discover.ingestStatus` and invalidates feeds when the job finishes
 * (`apps/web/app/(app)/discover/IngestStatusPoller.tsx`); mobile didn't.
 *
 * This hook polls `discover.ingestStatus` and returns per-feed
 * `refetchInterval` values that the Discover screen can pass straight
 * into its `useCachedQuery` calls. When a category's ingest is pending,
 * the matching feed re-fetches every `INGEST_POLL_INTERVAL_MS` so the
 * displayed count climbs as rows land in the DB. When nothing is pending,
 * the intervals resolve to `false` (no polling).
 *
 * Pure helpers (`totalPending`, `computeRefetchIntervals`,
 * `INGEST_POLL_INTERVAL_MS`) live in `./ingest-polling-helpers` so the
 * unit tests can import them without transitively pulling in React
 * Native via `../trpc` / `../cache`.
 */

import { trpc } from '../trpc';
import { useCachedQuery } from '../cache';
import {
  EMPTY_INGEST_SNAPSHOT,
  INGEST_POLL_INTERVAL_MS,
  computeRefetchIntervals,
  totalPending,
  type FeedRefetchIntervals,
  type IngestStatusSnapshot,
} from './ingest-polling-helpers';

export {
  INGEST_POLL_INTERVAL_MS,
  computeRefetchIntervals,
  totalPending,
  type FeedRefetchIntervals,
  type IngestStatusSnapshot,
};

export interface UseIngestPollingResult {
  pending: IngestStatusSnapshot;
  isAnyPending: boolean;
  intervals: FeedRefetchIntervals;
}

export function useIngestPolling({
  enabled,
}: {
  enabled: boolean;
}): UseIngestPollingResult {
  const utils = trpc.useUtils();

  const query = useCachedQuery<IngestStatusSnapshot>({
    queryKey: ['mobile', 'discover', 'ingestStatus'],
    queryFn: () => utils.client.discover.ingestStatus.query(),
    enabled,
    refetchInterval: (q) =>
      totalPending(q.state.data) > 0 ? INGEST_POLL_INTERVAL_MS : false,
    refetchOnWindowFocus: false,
    staleTime: 0,
  });

  const pending = query.data ?? EMPTY_INGEST_SNAPSHOT;
  return {
    pending,
    isAnyPending: totalPending(pending) > 0,
    intervals: computeRefetchIntervals(pending),
  };
}
