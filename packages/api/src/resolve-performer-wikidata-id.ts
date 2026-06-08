import { and, eq, isNull, sql } from 'drizzle-orm';
import { db, performers } from '@showbook/db';
import { child } from '@showbook/observability';
import { searchWikidataPeople } from './wikidata';
import { isUniqueViolation } from './venue-matcher';

const log = child({ component: 'api.resolve-performer-wikidata-id' });

export type ResolvePerformerWikidataIdOutcome =
  | { kind: 'updated'; wikidataQid: string }
  | { kind: 'no_match' }
  | { kind: 'skipped'; reason: 'row_already_filled' | 'other_row_owns_id' }
  | { kind: 'failed'; err: unknown };

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Resolve a performer's `wikidata_qid` by name via Wikidata's public
 * `wbsearchentities`, persisting with a race-guarded UPDATE. When the
 * matched entity carries a P18 image and/or a P434 MusicBrainz id, those
 * fill `image_url` / `musicbrainz_id` too (only when currently empty, via
 * COALESCE) — the headshot makes the cast member's artist page look like
 * any other, and the MBID unifies stage-and-screen people with their
 * concert rows (matchOrCreatePerformer matches on MBID before name).
 *
 * Used by:
 *   - `matchOrCreatePerformer` as a fire-and-forget hook after a newly-
 *     created row that has no Ticketmaster id (theatre cast entered via
 *     the typeahead / playbill extraction, plus other manual non-TM adds).
 *   - The `backfill-performer-wikidata-ids` cron + operator-triggered
 *     admin button for the existing backlog.
 *
 * Matching is conservative: we only accept a result whose normalized label
 * equals the performer's normalized name, so a name-only playbill row never
 * gets attached to a wrong same-prefix QID.
 *
 * Race guards: the UPDATE includes `wikidata_qid IS NULL` so a concurrent
 * fill (cron + inline hook) doesn't overwrite. The partial unique indexes
 * `performers_wikidata_uniq` / `performers_musicbrainz_uniq` catch the case
 * where another row already owns the QID (→ `other_row_owns_id`) or the
 * MBID (→ we retry the write without the MBID, keeping the QID + image).
 */
export async function resolvePerformerWikidataId(
  performerId: string,
  performerName: string,
): Promise<ResolvePerformerWikidataIdOutcome> {
  // Wikidata needs no API key, so the fire-and-forget hook would otherwise
  // make a real HTTP call from every non-TM create — including in unit /
  // integration tests, which must stay offline. The test scripts set
  // WIKIDATA_ENRICHMENT_DISABLED=1; prod/dev leave it unset (enabled).
  if (process.env.WIKIDATA_ENRICHMENT_DISABLED === '1') {
    return { kind: 'failed', err: new Error('wikidata enrichment disabled') };
  }

  let people;
  try {
    people = await searchWikidataPeople(performerName, 5);
  } catch (err) {
    log.error(
      { err, event: 'performer.wikidata_qid.failed', performerId, performerName },
      'Wikidata person search failed',
    );
    return { kind: 'failed', err };
  }

  const target = normalizeName(performerName);
  const hit = people.find((p) => normalizeName(p.name) === target) ?? null;
  if (!hit) {
    log.info(
      { event: 'performer.wikidata_qid.no_match', performerId, performerName },
      'No exact Wikidata person match for performer',
    );
    return { kind: 'no_match' };
  }

  const writeOnce = async (includeMbid: boolean): Promise<number> => {
    const set: Record<string, unknown> = { wikidataQid: hit.wikidataQid };
    if (hit.imageUrl) {
      set.imageUrl = sql`COALESCE(${performers.imageUrl}, ${hit.imageUrl})`;
    }
    if (hit.musicbrainzId && includeMbid) {
      set.musicbrainzId = sql`COALESCE(${performers.musicbrainzId}, ${hit.musicbrainzId})`;
    }
    const rows = await db
      .update(performers)
      .set(set)
      .where(
        and(eq(performers.id, performerId), isNull(performers.wikidataQid)),
      )
      .returning({ id: performers.id });
    return rows.length;
  };

  try {
    const n = await writeOnce(true);
    if (n === 0) {
      log.warn(
        {
          event: 'performer.wikidata_qid.conflict',
          performerId,
          performerName,
          wikidataQid: hit.wikidataQid,
          reason: 'row_already_filled',
        },
        'Wikidata QID set by another writer between SELECT and UPDATE',
      );
      return { kind: 'skipped', reason: 'row_already_filled' };
    }
    log.info(
      {
        event: 'performer.wikidata_qid.updated',
        performerId,
        performerName,
        wikidataQid: hit.wikidataQid,
        hasImage: !!hit.imageUrl,
        hasMbid: !!hit.musicbrainzId,
      },
      'Resolved performer Wikidata QID',
    );
    return { kind: 'updated', wikidataQid: hit.wikidataQid };
  } catch (err) {
    if (!isUniqueViolation(err)) {
      log.error(
        {
          err,
          event: 'performer.wikidata_qid.failed',
          performerId,
          performerName,
          wikidataQid: hit.wikidataQid,
        },
        'Persisting Wikidata QID failed',
      );
      return { kind: 'failed', err };
    }

    // A unique violation here is either the QID (another performer owns it)
    // or the MBID (P434 collides with an existing row). Retry without the
    // MBID to isolate: if it succeeds the collision was the MBID, so keep
    // the QID + image and drop the MBID; if it still violates, the QID is
    // owned elsewhere.
    try {
      const n = await writeOnce(false);
      if (n === 0) {
        return { kind: 'skipped', reason: 'row_already_filled' };
      }
      log.warn(
        {
          event: 'performer.mbid.conflict',
          performerId,
          performerName,
          musicbrainzId: hit.musicbrainzId,
          reason: 'other_row_owns_id',
        },
        'Wikidata-derived MBID owned by another performer row — wrote QID + image only',
      );
      log.info(
        {
          event: 'performer.wikidata_qid.updated',
          performerId,
          performerName,
          wikidataQid: hit.wikidataQid,
          hasImage: !!hit.imageUrl,
          hasMbid: false,
        },
        'Resolved performer Wikidata QID (MBID skipped due to conflict)',
      );
      return { kind: 'updated', wikidataQid: hit.wikidataQid };
    } catch (err2) {
      if (isUniqueViolation(err2)) {
        log.warn(
          {
            event: 'performer.wikidata_qid.conflict',
            performerId,
            performerName,
            wikidataQid: hit.wikidataQid,
            reason: 'other_row_owns_id',
          },
          'Wikidata QID already owned by another performer row — leaving this row null',
        );
        return { kind: 'skipped', reason: 'other_row_owns_id' };
      }
      log.error(
        {
          err: err2,
          event: 'performer.wikidata_qid.failed',
          performerId,
          performerName,
          wikidataQid: hit.wikidataQid,
        },
        'Persisting Wikidata QID failed on retry',
      );
      return { kind: 'failed', err: err2 };
    }
  }
}
