"use client";

import type React from "react";
import { Check, Eye } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useInvalidateSidebarCounts } from "@/lib/sidebar-counts";

/**
 * Watch / Unwatch toggle for a single announcement row. Owns its
 * mutations + sidebar-count invalidation; the parent controls the
 * "is this row currently watched" boolean and is notified on each
 * optimistic toggle so the list stays in sync.
 */
export function WatchButton({
  announcementId,
  isWatching,
  onToggle,
}: {
  announcementId: string;
  isWatching: boolean;
  onToggle: (id: string, watching: boolean) => void;
}) {
  const utils = trpc.useUtils();
  const invalidateSidebarCounts = useInvalidateSidebarCounts();

  const watchMutation = trpc.discover.watchlist.useMutation({
    onSuccess: () => {
      onToggle(announcementId, true);
      invalidateSidebarCounts();
      utils.shows.invalidate();
      utils.discover.watchedAnnouncementIds.invalidate();
    },
    onError: () => onToggle(announcementId, false),
  });

  const unwatchMutation = trpc.discover.unwatchlist.useMutation({
    onSuccess: () => {
      onToggle(announcementId, false);
      invalidateSidebarCounts();
      utils.shows.invalidate();
      utils.discover.watchedAnnouncementIds.invalidate();
    },
    onError: () => onToggle(announcementId, true),
  });

  const isPending = watchMutation.isPending || unwatchMutation.isPending;

  function handleClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (isPending) return;

    // Optimistic toggle
    onToggle(announcementId, !isWatching);

    if (isWatching) {
      unwatchMutation.mutate({ announcementId });
    } else {
      watchMutation.mutate({ announcementId });
    }
  }

  return (
    <button
      type="button"
      className={`discover-watch-btn ${isWatching ? "discover-watch-btn--watching" : ""}`}
      onClick={handleClick}
      disabled={isPending}
    >
      {isWatching ? (
        <>
          <Check size={11} />
          Watching
        </>
      ) : (
        <>
          <Eye size={11} />
          Watch
        </>
      )}
    </button>
  );
}
