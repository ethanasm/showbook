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
import { Sheet } from '../Sheet';
import { useFeedback } from '@/lib/feedback';
import { runOptimisticMutation } from '@/lib/mutations';
import { getCacheOutbox } from '@/lib/cache';
import { trpc } from '@/lib/trpc';
import { canAddRegion } from '@/lib/regions';
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
  const { showToast } = useFeedback();

  // The region cap mirrors the server guard in `preferences.addRegion`. We
  // only need the count when the regions tab is actually open, so the query
  // stays gated to avoid a needless round-trip on the venues / artists tabs.
  const prefs = trpc.preferences.get.useQuery(undefined, {
    enabled: open && tab === 'regions',
    staleTime: 60_000,
  });
  const regionsAtCap = !canAddRegion(prefs.data?.regions?.length ?? 0);

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
          reconcile: () => {
            void utils.preferences.get.invalidate();
            void utils.discover.nearbyFeed.invalidate();
            void utils.discover.ingestStatus.invalidate();
          },
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
    [utils, showToast, onClose],
  );

  return (
    <Sheet open={open} onClose={onClose} snapPoints={['72%']}>
      {tab === 'venues' ? (
        <FollowVenueSheetBody onFollowed={onClose} onClose={onClose} />
      ) : tab === 'artists' ? (
        <FollowArtistSheetBody onFollowed={onClose} onClose={onClose} />
      ) : (
        <AddRegionSheetBody
          onCancel={onClose}
          onSubmit={onRegionSubmit}
          atCap={regionsAtCap}
        />
      )}
    </Sheet>
  );
}
