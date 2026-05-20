/**
 * Shared "follow / unfollow" toggle for Discover announcements.
 *
 * Both the Discover tab and the venue / artist detail screens reach for
 * this hook so the optimistic cache patch and outbox plumbing stay in one
 * place. The optimistic step writes the new id-set into the shared
 * `watchedAnnouncementIds` cache key; callers pass an `onReconcile`
 * callback to invalidate any screen-specific queries (e.g. a venue's
 * `userShows` list, where the newly-created watching show needs to show
 * up after the round-trip).
 *
 * Filtering the on-screen "upcoming" list by membership in the watched
 * set gives the requested "row vanishes from Upcoming, drops into Your
 * Shows" UX without a second optimistic step — the cache key is the
 * single source of truth.
 */

import React from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { runOptimisticMutation } from './mutations';
import { getCacheOutbox } from './cache';
import { useFeedback } from './feedback';
import { trpc } from './trpc';

export const WATCHED_IDS_CACHE_KEY = ['mobile', 'discover', 'watchedAnnouncementIds'] as const;

export type WatchToggle = (
  announcementId: string,
  currentlyWatching: boolean,
) => Promise<void>;

export interface UseToggleWatchOptions {
  /** Screen-specific cache invalidations to run after a successful mutation. */
  onReconcile?: () => void;
}

export function useToggleWatch(opts: UseToggleWatchOptions = {}): WatchToggle {
  const utils = trpc.useUtils();
  const queryClient = useQueryClient();
  const { showToast } = useFeedback();
  const { onReconcile } = opts;

  return React.useCallback(
    async (announcementId, currentlyWatching) => {
      try {
        await runOptimisticMutation<
          { announcementId: string },
          readonly string[] | null,
          unknown
        >({
          mutation: currentlyWatching ? 'discover.unwatchlist' : 'discover.watchlist',
          input: { announcementId },
          outbox: getCacheOutbox(),
          call: (input) =>
            currentlyWatching
              ? utils.client.discover.unwatchlist.mutate(input)
              : utils.client.discover.watchlist.mutate(input),
          optimistic: {
            snapshot: () =>
              queryClient.getQueryData<readonly string[]>(WATCHED_IDS_CACHE_KEY) ??
              null,
            apply: () => {
              queryClient.setQueryData<readonly string[]>(
                WATCHED_IDS_CACHE_KEY,
                (prev) => {
                  const list = prev ?? [];
                  if (currentlyWatching) {
                    return list.filter((id) => id !== announcementId);
                  }
                  return list.includes(announcementId)
                    ? list
                    : [...list, announcementId];
                },
              );
            },
            rollback: (snap) => {
              queryClient.setQueryData(WATCHED_IDS_CACHE_KEY, snap ?? undefined);
            },
          },
          reconcile: () => {
            void utils.discover.watchedAnnouncementIds.invalidate();
            void utils.shows.list.invalidate();
            onReconcile?.();
          },
        });
      } catch {
        showToast({
          kind: 'info',
          text: currentlyWatching
            ? "We'll stop watching when you're back online."
            : "We'll watch when you're back online.",
        });
      }
    },
    [utils, queryClient, showToast, onReconcile],
  );
}
