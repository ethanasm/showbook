"use client";

import { trpc } from "@/lib/trpc";

/**
 * Sidebar counts (Upcoming / Logbook / Artists / Venues) are powered by three
 * dedicated count queries fetched once at the AppShell level. Mutations that
 * create or delete a show, change its state, or change the show's performers
 * or venue must invalidate these so the badges stay in sync without a page
 * reload. Call the returned function from a mutation's `onSuccess`.
 */
export function useInvalidateSidebarCounts() {
  const utils = trpc.useUtils();
  return () =>
    Promise.all([
      utils.shows.countsByMode.invalidate(),
      utils.performers.count.invalidate(),
      utils.venues.count.invalidate(),
    ]);
}
