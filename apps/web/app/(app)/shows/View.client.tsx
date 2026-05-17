"use client";

import ShowsListView from "@/components/shows-list/ShowsListView";

/**
 * Unified Shows hub. Owns the List / Calendar / Stats SegmentedControl
 * over the user's full show set — past, watching, ticketed — in a
 * single timeline. /upcoming and /logbook stay as filtered shortcuts
 * pointing at the same View component with `mode='upcoming' | 'logbook'`.
 */
export default function ShowsView() {
  return <ShowsListView mode="all" />;
}
