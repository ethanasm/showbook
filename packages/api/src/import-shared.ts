import { eq, inArray } from 'drizzle-orm';
import { performers, userPerformerFollows, type Database } from '@showbook/db';
import {
  searchAttractions,
  selectBestImage,
  extractMusicbrainzId,
  type TMAttraction,
} from './ticketmaster';
import { matchOrCreatePerformer } from './performer-matcher';
import { enqueueIngestPerformer } from './job-queue';
import { child } from '@showbook/observability';

const log = child({ component: 'api.import-shared' });

// Cap how many third-party artists we resolve against Ticketmaster in
// one listFollowed call. With concurrency=8 and ~300ms/request this
// caps end-to-end latency at ~5s for a heavy user.
export const TM_RESOLVE_CAP = 200;
const TM_RESOLVE_CONCURRENCY = 8;

export interface SourceArtist {
  /** Provider-native id (Spotify artist id, Apple Music library-artist id). */
  externalId: string;
  name: string;
  imageUrl: string | null;
  genres: string[];
}

export interface ResolvedArtistItem {
  externalId: string;
  name: string;
  imageUrl: string | null;
  genres: string[];
  tmMatch: {
    tmAttractionId: string;
    name: string;
    imageUrl: string | null;
    musicbrainzId: string | null;
  } | null;
  alreadyFollowed: boolean;
}

export interface ResolvedListResult {
  items: ResolvedArtistItem[];
  totalCount: number;
  resolvedCount: number;
  truncated: boolean;
}

async function resolveTmInBatches(
  artistNames: string[],
): Promise<(TMAttraction | null)[]> {
  const results: (TMAttraction | null)[] = new Array(artistNames.length).fill(null);
  for (let i = 0; i < artistNames.length; i += TM_RESOLVE_CONCURRENCY) {
    const batch = artistNames
      .slice(i, i + TM_RESOLVE_CONCURRENCY)
      .map((name, j) =>
        searchAttractions(name)
          .then((rows) => {
            // TM returns fuzzy matches; require an exact case-insensitive
            // name match so we'd rather skip than mis-match.
            const exact = rows.find(
              (r) => r.name.toLowerCase() === name.toLowerCase(),
            );
            results[i + j] = exact ?? null;
          })
          .catch((err) => {
            log.warn(
              { err, event: 'import.tm_resolve.failed', name },
              'TM resolve failed for artist',
            );
            results[i + j] = null;
          }),
      );
    await Promise.all(batch);
  }
  return results;
}

/**
 * Given a provider's followed-artist list, resolve each name against
 * Ticketmaster and check which matches the user already follows. Returns
 * a structure ready for both the Spotify and Apple Music routers; each
 * caller keeps its provider-specific id field name on top.
 */
export async function resolveArtistsForImport(
  db: Database,
  sourceArtists: SourceArtist[],
): Promise<ResolvedListResult> {
  const head = sourceArtists.slice(0, TM_RESOLVE_CAP);
  const tail = sourceArtists.slice(TM_RESOLVE_CAP);

  const tmMatches = await resolveTmInBatches(head.map((a) => a.name));

  const matchedTmIds = tmMatches
    .map((m) => m?.id)
    .filter((id): id is string => Boolean(id));

  const followedTmIds = new Set<string>();
  if (matchedTmIds.length > 0) {
    const rows = await db
      .select({ tmAttractionId: performers.ticketmasterAttractionId })
      .from(performers)
      .innerJoin(
        userPerformerFollows,
        eq(userPerformerFollows.performerId, performers.id),
      )
      .where(inArray(performers.ticketmasterAttractionId, matchedTmIds));
    for (const r of rows) {
      if (r.tmAttractionId) followedTmIds.add(r.tmAttractionId);
    }
  }

  const items: ResolvedArtistItem[] = head.map((artist, i) => {
    const tm = tmMatches[i];
    return {
      externalId: artist.externalId,
      name: artist.name,
      imageUrl: artist.imageUrl,
      genres: artist.genres,
      tmMatch: tm
        ? {
            tmAttractionId: tm.id,
            name: tm.name,
            imageUrl: selectBestImage(tm.images) ?? null,
            musicbrainzId: extractMusicbrainzId(tm) ?? null,
          }
        : null,
      alreadyFollowed: tm ? followedTmIds.has(tm.id) : false,
    };
  });

  const overflow: ResolvedArtistItem[] = tail.map((artist) => ({
    externalId: artist.externalId,
    name: artist.name,
    imageUrl: artist.imageUrl,
    genres: artist.genres,
    tmMatch: null,
    alreadyFollowed: false,
  }));

  return {
    items: [...items, ...overflow],
    totalCount: sourceArtists.length,
    resolvedCount: head.length,
    truncated: tail.length > 0,
  };
}

export interface ImportArtistInput {
  tmAttractionId: string;
  name: string;
  imageUrl?: string;
  musicbrainzId?: string;
}

/**
 * For each TM-matched artist run the same match-or-create + follow +
 * ingest path that `performers.followAttraction` uses. Returns
 * per-artist outcomes so callers can render a summary.
 */
export async function importSelectedArtists(
  db: Database,
  userId: string,
  artists: ImportArtistInput[],
  source: string,
): Promise<{
  imported: { performerId: string; name: string }[];
  skipped: { name: string; reason: string }[];
}> {
  const imported: { performerId: string; name: string }[] = [];
  const skipped: { name: string; reason: string }[] = [];

  for (const artist of artists) {
    try {
      const { performer } = await matchOrCreatePerformer({
        name: artist.name,
        tmAttractionId: artist.tmAttractionId,
        imageUrl: artist.imageUrl,
        musicbrainzId: artist.musicbrainzId,
      });
      await db
        .insert(userPerformerFollows)
        .values({ userId, performerId: performer.id })
        .onConflictDoNothing();
      await enqueueIngestPerformer(performer.id);
      imported.push({ performerId: performer.id, name: performer.name });
    } catch (err) {
      log.warn(
        { err, event: 'import.artist.failed', source, name: artist.name },
        'Failed to import single artist',
      );
      skipped.push({ name: artist.name, reason: 'import failed' });
    }
  }

  return { imported, skipped };
}
