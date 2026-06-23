/**
 * Cache invalidation helpers for cross-key read patterns.
 *
 * Several screens read `shows.list` under mobile-prefixed query keys
 * (e.g. `['mobile', 'home', 'shows.list']`) via `useCachedQuery`, while
 * mutations invalidate the tRPC-native key via `utils.shows.list.invalidate()`.
 * The two key spaces don't intersect, so add/edit/delete flows would
 * leave the Home + Shows tabs holding stale data until `staleTime`
 * elapsed (or the user pulled to refresh).
 *
 * `invalidateShowsList` fans out across every reader of `shows.list`
 * so a single call after a mutation keeps every screen in sync.
 */

import type { QueryClient } from '@tanstack/react-query';

const MOBILE_SHOWS_LIST_KEYS = [
  ['mobile', 'shows.list'],
  ['mobile', 'home', 'shows.list'],
] as const;

export function invalidateShowsList(queryClient: QueryClient): void {
  for (const key of MOBILE_SHOWS_LIST_KEYS) {
    void queryClient.invalidateQueries({ queryKey: key });
  }
}

/**
 * Structural slice of `trpc.useUtils()` — just the bit
 * `invalidateAllShowsLists` needs, so lib code stays decoupled from the
 * full router type.
 */
type ShowsListUtils = {
  shows: { list: { invalidate: () => Promise<unknown> } };
};

/**
 * Full post-mutation fan-out for show writes: the tRPC-native
 * `shows.list` key space (screens using `trpc.shows.list.useQuery`)
 * AND the mobile-prefixed readers (Home + Shows tabs via
 * `useCachedQuery`). Every show create/update/delete reconcile must
 * hit both key spaces — calling only `utils.shows.list.invalidate()`
 * leaves the Home and Shows tabs stale until `staleTime` elapses.
 */
export function invalidateAllShowsLists(
  queryClient: QueryClient,
  utils: ShowsListUtils,
): void {
  void utils.shows.list.invalidate();
  invalidateShowsList(queryClient);
}

/**
 * The Discover screen (`app/(tabs)/discover.tsx`) reads every feed,
 * followed-list, preference, and the ingest-status snapshot through
 * `useCachedQuery` under `['mobile', 'discover', …]` / `['mobile',
 * 'venues', 'followed']` etc. — *not* the tRPC-native keys. Follow /
 * unfollow / add-region mutations elsewhere call
 * `utils.discover.*.invalidate()`, which only touches the tRPC key
 * space, so the Discover tab stayed stale until a pull-to-refresh.
 *
 * Crucially, the auto-refresh poll only starts once the
 * `discover.ingestStatus` snapshot reports a pending job (see
 * `useIngestPolling`). Invalidating the *mobile* `ingestStatus` key is
 * therefore what arms the scoped poll for a just-followed entity — the
 * per-feed `refetchInterval` already narrows the actual polling to the
 * affected tab, so this fan-out is a one-shot refresh, not continuous
 * polling.
 *
 * `invalidateDiscoverFeeds` fans out across every Discover reader so a
 * single call after a follow / unfollow / add-region keeps the tab in
 * sync and kicks the ingest poll.
 */
const MOBILE_DISCOVER_KEYS = [
  ['mobile', 'discover', 'ingestStatus'],
  ['mobile', 'discover', 'followedFeed'],
  ['mobile', 'discover', 'followedArtistsFeed'],
  ['mobile', 'discover', 'nearbyFeed'],
  ['mobile', 'discover', 'digestFeed'],
  ['mobile', 'venues', 'followed'],
  ['mobile', 'artists', 'followed'],
  ['mobile', 'preferences', 'get'],
] as const;

export function invalidateDiscoverFeeds(queryClient: QueryClient): void {
  for (const key of MOBILE_DISCOVER_KEYS) {
    void queryClient.invalidateQueries({ queryKey: key });
  }
}
