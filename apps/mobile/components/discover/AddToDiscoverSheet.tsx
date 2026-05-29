/**
 * Bottom sheet wrapper that hosts the Discover add typeaheads. Dispatches
 * to the appropriate body per tab so the `Sheet` chrome (animation,
 * backdrop, keyboard avoidance) lives in one place rather than being
 * duplicated across three nearly-identical wrappers.
 *
 * Web equivalent: `FollowArtistSearch` (rail + cta variants),
 * `VenueSearchModal`, `RegionSearchModal`. Mobile rolls all three into
 * a single sheet so the Discover screen stays a flat tab.
 */

import React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Sheet } from '../Sheet';
import { useFeedback } from '@/lib/feedback';
import { runOptimisticMutation } from '@/lib/mutations';
import { getCacheOutbox, invalidateDiscoverFeeds } from '@/lib/cache';
import { trpc } from '@/lib/trpc';
import { FollowVenueSheetBody } from './FollowVenueSheetBody';
import { FollowArtistSheetBody } from './FollowArtistSheetBody';
import { AddRegionSheetBody } from './AddRegionSheetBody';

export type AddDiscoverTab = 'venues' | 'artists' | 'regions';

export function AddToDiscoverSheet({
  tab,
  open,
  onClose,
}: {
  tab: AddDiscoverTab;
  open: boolean;
  onClose: () => void;
}): React.JSX.Element {
  const utils = trpc.useUtils();
  const queryClient = useQueryClient();
  const { showToast } = useFeedback();

  const onRegionSubmit = React.useCallback(
    async (input: {
      cityName: string;
      latitude: number;
      longitude: number;
      radiusMiles: number;
    }) => {
      try {
        await runOptimisticMutation({
          mutation: 'preferences.addRegion',
          input,
          outbox: getCacheOutbox(),
          call: (i) => utils.client.preferences.addRegion.mutate(i),
          // Discover reads under `['mobile', …]` keys — fan out so the new
          // region chip appears and its scoped ingest poll arms immediately.
          reconcile: () => invalidateDiscoverFeeds(queryClient),
        });
        showToast({ kind: 'success', text: `Added ${input.cityName}` });
        onClose();
      } catch (err) {
        showToast({
          kind: 'error',
          text: err instanceof Error ? err.message : 'Could not add region',
        });
        throw err;
      }
    },
    [utils, queryClient, showToast, onClose],
  );

  return (
    <Sheet open={open} onClose={onClose} snapPoints={['72%']}>
      {tab === 'venues' ? (
        <FollowVenueSheetBody onFollowed={onClose} onClose={onClose} />
      ) : tab === 'artists' ? (
        <FollowArtistSheetBody onFollowed={onClose} onClose={onClose} />
      ) : (
        <AddRegionSheetBody onCancel={onClose} onSubmit={onRegionSubmit} />
      )}
    </Sheet>
  );
}
