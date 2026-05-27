/**
 * Pure helpers for `useIngestPolling` — kept in a sibling module so the
 * unit tests under `lib/__tests__/discover/` can import them without
 * pulling in the React Native / tRPC transitive deps that the hook itself
 * needs. (`tsx --test` chokes on RN's Flow-typed `index.js` at parse
 * time, which is why every other `lib/__tests__/` file is careful to
 * import only TS-pure modules.)
 */

export const INGEST_POLL_INTERVAL_MS = 5000;

export interface IngestStatusSnapshot {
  venueIds: string[];
  performerIds: string[];
  regionIds: string[];
}

export const EMPTY_INGEST_SNAPSHOT: IngestStatusSnapshot = {
  venueIds: [],
  performerIds: [],
  regionIds: [],
};

export function totalPending(
  snapshot: IngestStatusSnapshot | undefined | null,
): number {
  if (!snapshot) return 0;
  return (
    snapshot.venueIds.length +
    snapshot.performerIds.length +
    snapshot.regionIds.length
  );
}

export interface FeedRefetchIntervals {
  /** Nearby feed reacts to region *and* venue ingest (a followed venue
   *  may live inside one of the user's regions and surface there). */
  nearby: number | false;
  venues: number | false;
  artists: number | false;
}

export function computeRefetchIntervals(
  snapshot: IngestStatusSnapshot | undefined | null,
  intervalMs: number = INGEST_POLL_INTERVAL_MS,
): FeedRefetchIntervals {
  const venuesPending = (snapshot?.venueIds.length ?? 0) > 0;
  const artistsPending = (snapshot?.performerIds.length ?? 0) > 0;
  const regionsPending = (snapshot?.regionIds.length ?? 0) > 0;
  return {
    nearby: regionsPending || venuesPending ? intervalMs : false,
    venues: venuesPending ? intervalMs : false,
    artists: artistsPending ? intervalMs : false,
  };
}

/**
 * "The displayed Discover count may still grow." True when the hook is
 * enabled AND either the initial `ingestStatus` query hasn't returned
 * yet (we don't yet know whether ingest is pending) or it has returned
 * with pending jobs. Used by the Discover screen to render an inline,
 * non-blocking spinner next to the "N upcoming" summary so the user
 * knows the small initial number isn't final.
 */
export function computeIsPolling({
  enabled,
  statusLoading,
  snapshot,
}: {
  enabled: boolean;
  statusLoading: boolean;
  snapshot: IngestStatusSnapshot | undefined | null;
}): boolean {
  if (!enabled) return false;
  if (statusLoading) return true;
  return totalPending(snapshot) > 0;
}
