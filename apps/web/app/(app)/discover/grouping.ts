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

// ---------------------------------------------------------------------------
// "New for you" (digest) tab — group by the snapshot reason.
// ---------------------------------------------------------------------------

export type DigestReason = 'venue' | 'artist' | 'region';

// Section order mirrors the email's section order and the snapshot's bucket
// priority (venue > artist > region).
export const DIGEST_REASON_ORDER: DigestReason[] = ['venue', 'artist', 'region'];

export const DIGEST_REASON_HEADERS: Record<DigestReason, string> = {
  venue: 'At venues you follow',
  artist: 'By artists you follow',
  region: 'Near you',
};

/**
 * Bucket digest-feed rows into reason sections, preserving the server's
 * `position` ordering within each section (the input is assumed to already be
 * in `position` order). Empty sections are omitted. Rows with an unrecognized
 * reason are dropped (they have no section to live in).
 */
export function groupDigestByReason<T extends { reason?: string }>(
  items: readonly T[],
): { reason: DigestReason; items: T[] }[] {
  const buckets = new Map<DigestReason, T[]>();
  for (const item of items) {
    const reason = item.reason as DigestReason | undefined;
    if (!reason || !DIGEST_REASON_HEADERS[reason]) continue;
    const bucket = buckets.get(reason);
    if (bucket) bucket.push(item);
    else buckets.set(reason, [item]);
  }
  return DIGEST_REASON_ORDER.filter((r) => buckets.has(r)).map((reason) => ({
    reason,
    items: buckets.get(reason)!,
  }));
}
