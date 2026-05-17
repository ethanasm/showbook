"use client";

import { useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";
import type { PendingIngestSnapshot } from "./types";

/**
 * Polls `discover.ingestStatus` while jobs are in flight (2-second
 * interval, off otherwise) and notifies the parent of the latest
 * snapshot via `onUpdate`. When a job transitions from pending to
 * done, the relevant tRPC caches are invalidated so the feed updates
 * without a manual refresh.
 *
 * Headless — returns null. The visual progress indicator lives in
 * the parent <DiscoverView>.
 */
export function IngestStatusPoller({
  onUpdate,
}: {
  onUpdate: (pending: PendingIngestSnapshot) => void;
}) {
  const utils = trpc.useUtils();
  const status = trpc.discover.ingestStatus.useQuery(undefined, {
    refetchInterval: (query) => {
      const data = query.state.data;
      const total =
        (data?.venueIds.length ?? 0) +
        (data?.performerIds.length ?? 0) +
        (data?.regionIds.length ?? 0);
      return total > 0 ? 2000 : false;
    },
    refetchOnWindowFocus: false,
    staleTime: 0,
  });

  const data = status.data;
  const prevRef = useRef<PendingIngestSnapshot>({
    venueIds: [],
    performerIds: [],
    regionIds: [],
  });

  useEffect(() => {
    if (!data) return;
    onUpdate(data);

    const prev = prevRef.current;
    const venueDone = prev.venueIds.some((id) => !data.venueIds.includes(id));
    const performerDone = prev.performerIds.some(
      (id) => !data.performerIds.includes(id),
    );
    const regionDone = prev.regionIds.some(
      (id) => !data.regionIds.includes(id),
    );

    if (venueDone) {
      utils.discover.followedFeed.invalidate();
      utils.venues.followed.invalidate();
      utils.discover.nearbyFeed.invalidate();
    }
    if (performerDone) {
      utils.discover.followedArtistsFeed.invalidate();
      utils.performers.followed.invalidate();
    }
    if (regionDone) {
      utils.discover.nearbyFeed.invalidate();
    }

    prevRef.current = {
      venueIds: data.venueIds,
      performerIds: data.performerIds,
      regionIds: data.regionIds,
    };
  }, [data, onUpdate, utils]);

  return null;
}
