import { z } from 'zod';
import { child } from '@showbook/observability';

const log = child({ component: 'api.wikidata' });

// Wikidata's public MediaWiki action API. No key required, but the
// Wikimedia User-Agent policy asks for a descriptive UA with contact
// info — anonymous default UAs are rate-limited / blocked.
const API_URL = 'https://www.wikidata.org/w/api.php';
const USER_AGENT =
  'Showbook/1.0 (https://showbook.ethanasm.me; theatre cast enrichment)';

// Wikidata property + entity ids we read.
const P_IMAGE = 'P18'; // image (Wikimedia Commons filename)
const P_MUSICBRAINZ = 'P434'; // MusicBrainz artist id
const P_INSTANCE_OF = 'P31'; // instance of
const Q_HUMAN = 'Q5';

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Mirrors the transient-network handling in google-places.ts: undici
// surfaces socket resets as `err.cause.code` on a `TypeError: fetch
// failed`; those are connection blips, not API errors, so a retry on a
// fresh connection clears them. HTTP error *responses* don't throw and
// are handled by each caller's `res.ok` check.
const TRANSIENT_CAUSE_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'EAI_AGAIN',
  'EPIPE',
  'ENOTFOUND',
  'UND_ERR_SOCKET',
]);

function isTransientFetchError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === 'TimeoutError' || err.name === 'AbortError') return true;
  const code = (err as { cause?: { code?: unknown } }).cause?.code;
  if (typeof code === 'string' && TRANSIENT_CAUSE_CODES.has(code)) return true;
  return err instanceof TypeError && err.message === 'fetch failed';
}

async function fetchWithRetry(
  url: string,
  call: string,
  attempts = 3,
): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        signal: AbortSignal.timeout(8_000),
      });
    } catch (err) {
      lastErr = err;
      if (attempt >= attempts || !isTransientFetchError(err)) throw err;
      const code =
        (err as { cause?: { code?: string } }).cause?.code ??
        (err instanceof Error ? err.name : 'unknown');
      log.warn(
        { event: 'wikidata.request.retry', call, code },
        'Transient Wikidata network error; retrying',
      );
      await sleep(attempt * 300);
    }
  }
  throw lastErr;
}

export interface WikidataPerson {
  wikidataQid: string;
  name: string;
  /** Short disambiguating description, e.g. "American actor". */
  description: string | null;
  imageUrl: string | null;
  musicbrainzId: string | null;
}

export interface WikidataEntityData {
  imageUrl: string | null;
  musicbrainzId: string | null;
}

// A Wikimedia Commons file is served from a stable redirecting URL:
// Special:FilePath/<file>?width=N → 302 to the upload.wikimedia.org CDN.
// We persist this URL to `performers.image_url`; the image proxy
// (apps/web/lib/image-proxy.ts) allowlists commons.wikimedia.org and
// follows the one hop to upload.wikimedia.org.
export function commonsFilePathUrl(filename: string, width = 600): string {
  const normalized = filename.replace(/ /g, '_');
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(
    normalized,
  )}?width=${width}`;
}

const SearchResponseSchema = z
  .object({
    search: z
      .array(
        z
          .object({
            id: z.string(),
            label: z.string().optional(),
            description: z.string().optional(),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();

// The wbgetentities claims envelope is deeply nested and varies by
// datatype, so we validate only the outer shape and pull claim values
// with defensive guards (same approach as pickBestPhotoName in
// google-places.ts).
const EntitiesResponseSchema = z
  .object({
    entities: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

function firstClaimValue(entity: unknown, property: string): unknown {
  const claims = (entity as { claims?: Record<string, unknown> })?.claims;
  const statements = claims?.[property];
  if (!Array.isArray(statements) || statements.length === 0) return undefined;
  return (statements[0] as { mainsnak?: { datavalue?: { value?: unknown } } })
    ?.mainsnak?.datavalue?.value;
}

function isHuman(entity: unknown): boolean {
  const claims = (entity as { claims?: Record<string, unknown> })?.claims;
  const statements = claims?.[P_INSTANCE_OF];
  if (!Array.isArray(statements)) return false;
  return statements.some(
    (s) =>
      (s as { mainsnak?: { datavalue?: { value?: { id?: unknown } } } })
        ?.mainsnak?.datavalue?.value?.id === Q_HUMAN,
  );
}

function extractEntityData(entity: unknown): WikidataEntityData {
  const image = firstClaimValue(entity, P_IMAGE);
  const mbid = firstClaimValue(entity, P_MUSICBRAINZ);
  return {
    imageUrl: typeof image === 'string' && image ? commonsFilePathUrl(image) : null,
    musicbrainzId: typeof mbid === 'string' && mbid ? mbid : null,
  };
}

// Fetch claims for up to 50 QIDs in one call. Returns a map keyed by QID.
async function fetchEntityClaims(
  qids: string[],
): Promise<Map<string, unknown>> {
  const result = new Map<string, unknown>();
  if (qids.length === 0) return result;

  const params = new URLSearchParams({
    action: 'wbgetentities',
    ids: qids.slice(0, 50).join('|'),
    props: 'claims',
    format: 'json',
    formatversion: '2',
  });

  const res = await fetchWithRetry(
    `${API_URL}?${params.toString()}`,
    'wbgetentities',
  );
  if (!res.ok) {
    log.error(
      { event: 'wikidata.request.error', call: 'wbgetentities', status: res.status },
      'wbgetentities error',
    );
    return result;
  }

  const raw = await res.json();
  const parsed = EntitiesResponseSchema.safeParse(raw);
  if (!parsed.success) {
    log.error(
      {
        event: 'wikidata.request.parse_failed',
        call: 'wbgetentities',
        issues: parsed.error.issues.slice(0, 5),
      },
      'wbgetentities response did not match expected shape',
    );
    return result;
  }

  const entities = parsed.data.entities ?? {};
  for (const [qid, entity] of Object.entries(entities)) {
    result.set(qid, entity);
  }
  return result;
}

/**
 * Typeahead search for people on Wikidata. Returns humans only, enriched
 * with a headshot (P18) and MusicBrainz id (P434) where present, plus the
 * short description used to disambiguate same-named results in the picker.
 *
 * Two calls: `wbsearchentities` (label + description prefix match) then a
 * single batched `wbgetentities` for claims. Errors degrade to `[]` so the
 * typeahead never throws (mirrors performers.searchExternal's TM branch).
 */
export async function searchWikidataPeople(
  query: string,
  limit = 8,
): Promise<WikidataPerson[]> {
  const trimmed = query.trim();
  if (trimmed.length < 1) return [];

  const params = new URLSearchParams({
    action: 'wbsearchentities',
    search: trimmed,
    language: 'en',
    uselang: 'en',
    type: 'item',
    limit: String(Math.min(limit * 2, 20)),
    format: 'json',
    formatversion: '2',
  });

  let candidates: { id: string; label?: string; description?: string }[];
  try {
    const res = await fetchWithRetry(
      `${API_URL}?${params.toString()}`,
      'wbsearchentities',
    );
    if (!res.ok) {
      log.error(
        {
          event: 'wikidata.request.error',
          call: 'wbsearchentities',
          status: res.status,
        },
        'wbsearchentities error',
      );
      return [];
    }
    const raw = await res.json();
    const parsed = SearchResponseSchema.safeParse(raw);
    if (!parsed.success) {
      log.error(
        {
          event: 'wikidata.request.parse_failed',
          call: 'wbsearchentities',
          issues: parsed.error.issues.slice(0, 5),
        },
        'wbsearchentities response did not match expected shape',
      );
      return [];
    }
    candidates = parsed.data.search ?? [];
  } catch (err) {
    log.error(
      { err, event: 'wikidata.request.error', call: 'wbsearchentities' },
      'wbsearchentities failed',
    );
    return [];
  }

  if (candidates.length === 0) return [];

  const claimsByQid = await fetchEntityClaims(candidates.map((c) => c.id));

  const people: WikidataPerson[] = [];
  for (const c of candidates) {
    const entity = claimsByQid.get(c.id);
    // Keep humans only — drops works, characters, organisations that
    // share a label with the actor we're after.
    if (!entity || !isHuman(entity)) continue;
    const { imageUrl, musicbrainzId } = extractEntityData(entity);
    people.push({
      wikidataQid: c.id,
      name: c.label ?? trimmed,
      description: c.description ?? null,
      imageUrl,
      musicbrainzId,
    });
    if (people.length >= limit) break;
  }
  return people;
}

/**
 * Resolve a single QID's headshot (P18) + MusicBrainz id (P434). Used by
 * the performer-photo proxy's lazy self-heal and the resolver/backfill
 * when only the QID is known. Returns null image/mbid on any failure.
 */
export async function resolveWikidataEntity(
  qid: string,
): Promise<WikidataEntityData> {
  const claimsByQid = await fetchEntityClaims([qid]);
  const entity = claimsByQid.get(qid);
  if (!entity) return { imageUrl: null, musicbrainzId: null };
  return extractEntityData(entity);
}
