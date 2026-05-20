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
