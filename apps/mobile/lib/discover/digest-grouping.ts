/**
 * Pure grouping helper for the Discover "New for you" (digest) tab.
 *
 * The digest feed (`discover.digestFeed`) returns the user's persisted
 * daily-digest snapshot in bucket order (venue > artist > region, then date),
 * each row tagged with a `reason`. The tab renders one section per reason,
 * mirroring the digest email's sections. Lives in `lib/` (inside the mobile
 * coverage gate) and mirrors the web `groupDigestByReason` in
 * `apps/web/app/(app)/discover/grouping.ts`.
 */

export type DigestReason = 'venue' | 'artist' | 'region';

// Section order mirrors the email + the snapshot's bucket priority.
export const DIGEST_REASON_ORDER: DigestReason[] = ['venue', 'artist', 'region'];

export const DIGEST_REASON_HEADERS: Record<DigestReason, string> = {
  venue: 'At venues you follow',
  artist: 'By artists you follow',
  region: 'Near you',
};

/**
 * Bucket digest rows into reason sections, preserving input (position) order
 * within each section. Empty sections are omitted; rows with an unrecognized
 * or missing reason are dropped (no section to live in).
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
