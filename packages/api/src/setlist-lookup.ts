/**
 * Shared "look up the setlist for a performer on a date" helper, used by
 * both the in-band shows.create enrichment path (Gmail import etc.) and the
 * background setlist-retry job. Centralising it keeps the MBID-resolution
 * + persist + searchSetlist sequence consistent across call sites.
 */

import { eq } from 'drizzle-orm';
import { db, performers } from '@showbook/db';
import type { PerformerSetlist } from '@showbook/shared';
import { child } from '@showbook/observability';
import { searchArtist, searchSetlist } from './setlistfm';

const log = child({ component: 'api.setlist-lookup' });

export interface SetlistLookupResult {
  setlist: PerformerSetlist;
  tourName: string | null;
}

/**
 * Try to fetch a setlist for `performer` on `date` from setlist.fm.
 *
 * Returns `null` when the artist can't be resolved to an MBID or no setlist
 * was found for that date — callers should treat this as "not available
 * right now, retry later". Throws on network / API errors so callers can
 * distinguish a real failure from a clean "no result".
 *
 * Side-effect: persists a newly-resolved MBID on the `performers` row so
 * the next lookup skips the artist-search hop.
 */
export async function fetchSetlistForPerformer(input: {
  performerId: string;
  performerName: string;
  performerMbid: string | null;
  date: string;
}): Promise<SetlistLookupResult | null> {
  let mbid = input.performerMbid;
  if (!mbid) {
    const artists = await searchArtist(input.performerName);
    if (artists.length > 0) {
      mbid = artists[0]!.mbid;
      await db
        .update(performers)
        .set({ musicbrainzId: mbid })
        .where(eq(performers.id, input.performerId));
      log.info(
        {
          event: 'setlist_lookup.mbid_resolved',
          performerId: input.performerId,
          performerName: input.performerName,
          mbid,
        },
        'Resolved MBID for performer via setlist.fm search',
      );
    }
  }
  if (!mbid) return null;

  const result = await searchSetlist(mbid, input.date);
  if (!result) return null;

  return {
    setlist: result.setlist,
    tourName: result.tourName ?? null,
  };
}
