import { db, performers, type Database } from '@showbook/db';
import { eq, sql } from 'drizzle-orm';
import { child } from '@showbook/observability';
import { resolvePerformerSpotifyId } from './resolve-performer-spotify-id';

const log = child({ component: 'api.performer-matcher' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PerformerInput {
  name: string;
  tmAttractionId?: string;
  musicbrainzId?: string;
  spotifyArtistId?: string;
  imageUrl?: string;
}

export interface PerformerMatchResult {
  performer: typeof performers.$inferSelect;
  created: boolean;
}

type Tx = Database | Parameters<Parameters<Database['transaction']>[0]>[0];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function buildUpdate(
  existing: typeof performers.$inferSelect,
  input: PerformerInput,
): Partial<
  Record<
    'imageUrl' | 'musicbrainzId' | 'ticketmasterAttractionId' | 'spotifyArtistId',
    string
  >
> | null {
  const updates: Record<string, string> = {};

  if (!existing.imageUrl && input.imageUrl) {
    updates.imageUrl = input.imageUrl;
  }
  if (!existing.musicbrainzId && input.musicbrainzId) {
    updates.musicbrainzId = input.musicbrainzId;
  }
  if (!existing.ticketmasterAttractionId && input.tmAttractionId) {
    updates.ticketmasterAttractionId = input.tmAttractionId;
  }
  if (!existing.spotifyArtistId && input.spotifyArtistId) {
    updates.spotifyArtistId = input.spotifyArtistId;
  }

  return Object.keys(updates).length > 0 ? updates : null;
}

async function applyUpdates(
  tx: Tx,
  existing: typeof performers.$inferSelect,
  input: PerformerInput,
): Promise<typeof performers.$inferSelect> {
  const updates = buildUpdate(existing, input);
  if (!updates) return existing;

  const [updated] = await tx
    .update(performers)
    .set(updates)
    .where(eq(performers.id, existing.id))
    .returning();

  return updated;
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

export async function matchOrCreatePerformer(
  input: PerformerInput,
): Promise<PerformerMatchResult> {
  const result = await matchOrCreatePerformerInner(input);
  // Fire-and-forget Spotify ID resolution for newly-created rows that
  // didn't already get a Spotify ID from the caller. This is the single
  // hook that covers every ingest path — Add Show form/chat, scrapers,
  // discover ingest, festival lineup picker, Spotify follow import —
  // because every create funnels through here. Caller never waits on it;
  // the nightly `backfill-performer-spotify-ids` cron is the safety net
  // for failures. Errors are logged at warn inside the resolver.
  if (result.created && !result.performer.spotifyArtistId) {
    void resolvePerformerSpotifyId(
      result.performer.id,
      result.performer.name,
    ).catch((err) => {
      // Defence-in-depth — `resolvePerformerSpotifyId` already catches
      // its own errors and returns a tagged outcome. This catch is for
      // the bug where the function itself throws (e.g. import failure
      // during HMR).
      log.warn(
        {
          err,
          event: 'performer.spotify_id.resolve_inline_uncaught',
          performerId: result.performer.id,
        },
        'Inline Spotify ID resolver threw',
      );
    });
  }
  return result;
}

async function matchOrCreatePerformerInner(
  input: PerformerInput,
): Promise<PerformerMatchResult> {
  // 1. TM attraction ID match. Backed by a partial UNIQUE index, so a
  //    concurrent insert that races us will fail with 23505 and we'll
  //    re-select.
  if (input.tmAttractionId) {
    const [match] = await db
      .select()
      .from(performers)
      .where(eq(performers.ticketmasterAttractionId, input.tmAttractionId))
      .limit(1);

    if (match) {
      return { performer: await applyUpdates(db, match, input), created: false };
    }
  }

  // 2. MusicBrainz ID match — same shape.
  if (input.musicbrainzId) {
    const [match] = await db
      .select()
      .from(performers)
      .where(eq(performers.musicbrainzId, input.musicbrainzId))
      .limit(1);

    if (match) {
      return { performer: await applyUpdates(db, match, input), created: false };
    }
  }

  // 3. Case-insensitive name match + create-if-missing under a transaction
  //    advisory lock. The lock is keyed on lower(name) so two concurrent
  //    requests for the same artist serialize, while different names
  //    proceed in parallel. Without it, both would miss the SELECT and
  //    both would INSERT, yielding duplicate global rows.
  return await db.transaction(async (tx) => {
    const lockKey = input.name.trim().toLowerCase();
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${lockKey}))`);

    const [nameMatch] = await tx
      .select()
      .from(performers)
      .where(sql`lower(${performers.name}) = lower(${input.name})`)
      .limit(1);

    if (nameMatch) {
      return { performer: await applyUpdates(tx, nameMatch, input), created: false };
    }

    try {
      // Wrap the INSERT in a savepoint (nested tx) so a unique-violation
      // doesn't poison the outer transaction. Without this, the SELECT in
      // the catch block would fail with 25P02 ("current transaction is
      // aborted") and we couldn't recover.
      const [created] = await tx.transaction(async (sp) =>
        sp
          .insert(performers)
          .values({
            name: input.name,
            ticketmasterAttractionId: input.tmAttractionId ?? null,
            musicbrainzId: input.musicbrainzId ?? null,
            spotifyArtistId: input.spotifyArtistId ?? null,
            imageUrl: input.imageUrl ?? null,
          })
          .returning(),
      );
      // Track create rate by external-ID coverage. A spike in `created` events
      // with all three flags false means the Add flow is dropping enrichment
      // before it gets here (which is exactly what Brandon hit on 2026-04-30
      // for Royel Otis + STRFKR).
      log.info(
        {
          event: 'performer.match.created',
          performerId: created.id,
          name: created.name,
          hasTm: !!input.tmAttractionId,
          hasMbid: !!input.musicbrainzId,
          hasSpotify: !!input.spotifyArtistId,
          hasImage: !!input.imageUrl,
        },
        'Performer created',
      );
      return { performer: created, created: true };
    } catch (err) {
      // External-ID unique-violation (different name but same TM/MBID) —
      // fall back to whatever already exists for that ID.
      if (isUniqueViolation(err)) {
        const conflictId = input.tmAttractionId ?? input.musicbrainzId;
        if (conflictId) {
          const [existing] = await tx
            .select()
            .from(performers)
            .where(
              input.tmAttractionId
                ? eq(performers.ticketmasterAttractionId, input.tmAttractionId)
                : eq(performers.musicbrainzId, input.musicbrainzId!),
            )
            .limit(1);
          if (existing) {
            log.warn(
              {
                event: 'performer.match.race_recovered',
                performerId: existing.id,
                name: existing.name,
                conflictKey: input.tmAttractionId ? 'tm' : 'mbid',
              },
              'Recovered from concurrent insert race via external-ID re-select',
            );
            return { performer: existing, created: false };
          }
        }
      }
      throw err;
    }
  });
}

export function isUniqueViolation(err: unknown): boolean {
  // drizzle-orm wraps the underlying postgres error in DrizzleQueryError,
  // moving the SQLSTATE off `err.code` and onto `err.cause.code`. Walk the
  // cause chain so callers don't have to care which layer threw.
  let cur = err;
  while (cur != null && typeof cur === 'object') {
    if ((cur as { code?: string }).code === '23505') return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}
