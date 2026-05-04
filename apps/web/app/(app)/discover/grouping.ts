/**
 * Group-key helpers for the Discover page.
 *
 * For the artist tab, a single announcement may belong to MULTIPLE followed-artist
 * groups: the headliner plus any followed support acts. Sam Short opening for
 * Two Feet should show up on Sam Short's rail row AND on Two Feet's row when
 * both are followed. For the venue tab there's only ever one group key.
 *
 * Returning a `string[]` lets the call sites fan-out the increment/filter
 * cleanly with a single rule rather than special-casing artists everywhere.
 */

export type GroupableAnnouncement = {
  headlinerPerformerId: string | null;
  supportPerformerIds: string[] | null;
  venue: { id: string };
};

export function computeAnnouncementGroupKeys(
  item: GroupableAnnouncement,
  groupBy: 'venue' | 'artist' | 'region',
  allFollowedArtists?: { id: string }[],
): string[] {
  if (groupBy !== 'artist') {
    return item.venue.id ? [item.venue.id] : [];
  }
  const ids = new Set<string>();
  if (item.headlinerPerformerId) ids.add(item.headlinerPerformerId);
  if (item.supportPerformerIds) {
    for (const id of item.supportPerformerIds) ids.add(id);
  }
  // When the user has a known followed-artists list, restrict groupings to
  // those — an announcement matched into the artist feed via support
  // shouldn't spawn a new rail row for an unrelated support act (e.g.
  // "Brothel" tagging along on a Two Feet show). If the list isn't loaded
  // yet, fall back to all ids so the first paint still buckets correctly.
  if (allFollowedArtists) {
    const followed = new Set(allFollowedArtists.map((a) => a.id));
    return [...ids].filter((id) => followed.has(id));
  }
  return [...ids];
}
