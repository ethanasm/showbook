/**
 * Shared show form data model + per-kind save serialization.
 *
 * The mobile add/edit form keeps a single, kind-agnostic `FormValues`
 * object so the user can switch between kinds without losing field
 * data (a comedian typed under "Concert" stays in the field when they
 * flip to "Festival"). Each `PerformerRow` carries every per-kind
 * trailing field — `characterName` for theatre cast, `tier` for
 * festival headliner/support — and the active kind decides which of
 * those projections gets written when the form is saved.
 *
 * `serializeShowFormForKind` is the single source of truth for that
 * projection. It's pure so it can be unit-tested without React or
 * tRPC, and the screens just hand its output straight to
 * `shows.create` / `shows.update`.
 */

export type ShowFormKind = 'concert' | 'theatre' | 'comedy' | 'festival';

/**
 * Stable identity for a lineup row. The `id` is a client-generated uuid
 * used as the FlatList key + drag-handle target. It is NOT the
 * performer's persisted id — we only know that after the server
 * resolves the row via `matchOrCreatePerformer`.
 */
export interface PerformerRow {
  id: string;
  name: string;
  /** Theatre cast role label ("Eurydice", "Hermes"). Ignored for non-theatre kinds. */
  characterName?: string;
  /** Festival tier toggle. Defaults to 'support' for new rows. Ignored for non-festival kinds. */
  tier?: 'headliner' | 'support';
  tmAttractionId?: string;
  /** Wikidata QID for theatre cast (no Ticketmaster page). */
  wikidataQid?: string;
  musicbrainzId?: string;
  imageUrl?: string;
}

export interface ShowFormVenue {
  id?: string;
  name: string;
  city?: string | null;
  stateRegion?: string | null;
  country?: string | null;
}

export interface ShowFormValues {
  kind: ShowFormKind;
  /**
   * Primary title. Used as the concert/comedy headliner name, the
   * theatre production title, and the festival name. Label flips by
   * kind in the UI.
   */
  title: string;
  /** Free-text venue query (when the user hasn't picked a suggestion). */
  venueQuery: string;
  venue: ShowFormVenue | null;
  /** ISO date string YYYY-MM-DD. */
  date: string;
  /** ISO date string YYYY-MM-DD. Festival end date — only used for festival. */
  endDate: string;
  /** Seat / row / section text. Only used for non-festival kinds. */
  seat: string;
  pricePaid: string;
  ticketCount: string;
  /** Concert tour name. Only used for concert. */
  tourName: string;
  notes: string;
  performers: PerformerRow[];
}

export interface SerializedShowVenue {
  name: string;
  city: string;
  stateRegion?: string;
  country?: string;
}

export interface SerializedShowHeadliner {
  name: string;
  tmAttractionId?: string;
  wikidataQid?: string;
  musicbrainzId?: string;
  imageUrl?: string;
}

export interface SerializedShowPerformer {
  name: string;
  role: 'headliner' | 'support' | 'cast';
  characterName?: string;
  sortOrder: number;
  tmAttractionId?: string;
  wikidataQid?: string;
  musicbrainzId?: string;
  imageUrl?: string;
}

/**
 * Wire-shape payload matching the `shows.create` / `shows.update`
 * input. `showId` is added by the edit screen before sending.
 */
export interface SerializedShowInput {
  kind: ShowFormKind;
  headliner: SerializedShowHeadliner;
  venue: SerializedShowVenue;
  date: string;
  endDate?: string;
  seat?: string;
  pricePaid?: string;
  ticketCount: number;
  tourName?: string;
  productionName?: string;
  notes?: string;
  performers?: SerializedShowPerformer[];
}

const PERFORMER_ENRICHMENT_KEYS = ['tmAttractionId', 'wikidataQid', 'musicbrainzId', 'imageUrl'] as const;

type PerformerEnrichment = Pick<
  PerformerRow,
  'tmAttractionId' | 'wikidataQid' | 'musicbrainzId' | 'imageUrl'
>;

function pickEnrichment(row: PerformerEnrichment): Partial<PerformerEnrichment> {
  const out: Partial<PerformerEnrichment> = {};
  for (const key of PERFORMER_ENRICHMENT_KEYS) {
    const v = row[key];
    if (typeof v === 'string' && v.length > 0) out[key] = v;
  }
  return out;
}

function findHeadlinerEnrichment(
  performers: readonly PerformerRow[],
  headlinerName: string,
): PerformerEnrichment {
  // Concert/comedy don't show a tier toggle, so a typeahead-picked
  // headliner has no in-form lineup row to inherit IDs from. Concerts
  // currently fall through to free-text {name} only — that's fine; the
  // server's matchOrCreatePerformer resolves by name and the nightly
  // backfill job fills in the IDs. This helper exists for the kinds
  // (festival) where the headliner name CAN match a lineup row.
  const trimmed = headlinerName.trim().toLowerCase();
  if (trimmed.length === 0) return {};
  for (const row of performers) {
    if (row.name.trim().toLowerCase() === trimmed) return pickEnrichment(row);
  }
  return {};
}

function rowsForKind(
  performers: readonly PerformerRow[],
  kind: ShowFormKind,
  options: { excludeNameMatching?: string } = {},
): SerializedShowPerformer[] {
  const skipName = options.excludeNameMatching?.trim().toLowerCase();
  const out: SerializedShowPerformer[] = [];
  let sortOrder = 1;
  for (const row of performers) {
    const name = row.name.trim();
    if (name.length === 0) continue;
    if (skipName && name.toLowerCase() === skipName) continue;

    let role: 'headliner' | 'support' | 'cast';
    let characterName: string | undefined;
    if (kind === 'theatre') {
      role = 'cast';
      const c = row.characterName?.trim();
      if (c && c.length > 0) characterName = c;
    } else if (kind === 'festival') {
      role = row.tier === 'headliner' ? 'headliner' : 'support';
    } else {
      role = 'support';
    }

    out.push({
      name,
      role,
      ...(characterName ? { characterName } : {}),
      sortOrder: sortOrder++,
      ...pickEnrichment(row),
    });
  }
  return out;
}

function venuePayload(values: ShowFormValues): SerializedShowVenue {
  if (values.venue) {
    const out: SerializedShowVenue = {
      name: values.venue.name,
      city: values.venue.city ?? 'Unknown',
    };
    if (values.venue.stateRegion) out.stateRegion = values.venue.stateRegion;
    if (values.venue.country) out.country = values.venue.country;
    return out;
  }
  return { name: values.venueQuery.trim(), city: 'Unknown' };
}

/**
 * Project the cross-kind form state to the `shows.create`/`update`
 * wire shape for the active kind. Pure — drives unit tests.
 *
 * Per-kind behavior:
 *   - concert: title → headliner; rows → support performers; tourName / seat retained.
 *   - theatre: title → productionName + headliner.name; rows → cast (with characterName); seat retained.
 *   - comedy:  title → headliner; rows → support performers; seat retained.
 *   - festival: title → productionName + headliner.name; rows → headliner/support by row.tier; endDate retained; seat dropped.
 */
export function serializeShowFormForKind(
  values: ShowFormValues,
  kind: ShowFormKind = values.kind,
): SerializedShowInput {
  const title = values.title.trim();
  const headlinerEnrichment =
    kind === 'festival' ? findHeadlinerEnrichment(values.performers, title) : {};

  const headliner: SerializedShowHeadliner = { name: title, ...headlinerEnrichment };

  // For festival, drop any lineup row whose name matches the festival
  // name. The backend treats festivals like theatre (no headliner
  // performer is created from `headliner.name`; the festival name lives
  // on shows.production_name only), but a row whose name matches the
  // festival is still a confusing duplicate to show in the lineup card,
  // so we strip it here for the same reason theatre strips a cast row
  // matching the play title.
  const performers = rowsForKind(
    values.performers,
    kind,
    kind === 'festival' ? { excludeNameMatching: title } : {},
  );

  const ticketCountParsed = Math.max(1, Number(values.ticketCount) || 1);
  const trimmedPrice = values.pricePaid.trim();
  const trimmedTour = values.tourName.trim();
  const trimmedNotes = values.notes.trim();
  const trimmedSeat = values.seat.trim();
  const trimmedEnd = values.endDate.trim();

  const out: SerializedShowInput = {
    kind,
    headliner,
    venue: venuePayload(values),
    date: values.date,
    ticketCount: ticketCountParsed,
  };

  if (trimmedPrice.length > 0) out.pricePaid = trimmedPrice;
  if (trimmedNotes.length > 0) out.notes = trimmedNotes;

  if (kind !== 'festival' && trimmedSeat.length > 0) out.seat = trimmedSeat;
  if (kind === 'concert' && trimmedTour.length > 0) out.tourName = trimmedTour;
  if (kind === 'festival' && trimmedEnd.length > 0) out.endDate = trimmedEnd;

  // Theatre stores the production title on the show row; festivals
  // also use productionName for the festival name even though there's
  // a headliner performer carrying the same string.
  if ((kind === 'theatre' || kind === 'festival') && title.length > 0) {
    out.productionName = title;
  }

  if (performers.length > 0) out.performers = performers;

  return out;
}

// ---------------------------------------------------------------------------
// Hydration helpers
// ---------------------------------------------------------------------------

/**
 * Per-row shape returned by `shows.detail`. Loose typing so callers
 * can hand the tRPC result straight in without an intermediate cast.
 */
export interface ShowDetailPerformer {
  role: 'headliner' | 'support' | 'cast';
  sortOrder: number;
  characterName?: string | null;
  performer: {
    name: string;
    ticketmasterAttractionId?: string | null;
    wikidataQid?: string | null;
    musicbrainzId?: string | null;
    imageUrl?: string | null;
  };
}

export interface ShowDetailLite {
  kind: ShowFormKind;
  date: string | null;
  endDate?: string | null;
  seat: string | null;
  pricePaid: string | null;
  ticketCount: number | null;
  tourName: string | null;
  productionName: string | null;
  notes: string | null;
  venue: {
    id: string;
    name: string;
    city: string;
    stateRegion?: string | null;
    country?: string | null;
  };
  showPerformers: ShowDetailPerformer[];
}

/**
 * Build the initial mobile-form values from a `shows.detail`
 * payload. Inverse of `serializeShowFormForKind` modulo enrichment
 * fields the API already resolved.
 */
export function buildShowFormFromDetail(
  detail: ShowDetailLite,
  newRowId: () => string,
): ShowFormValues {
  const performers = [...detail.showPerformers].sort((a, b) => a.sortOrder - b.sortOrder);

  let title: string;
  let lineup: ShowDetailPerformer[];
  if (detail.kind === 'theatre') {
    // Theatre's "headliner" is the production title — stored on the
    // show row, no headliner performer exists. All rows are cast.
    title = detail.productionName ?? performers.find((p) => p.role === 'headliner')?.performer.name ?? '';
    lineup = performers.filter((p) => p.role === 'cast');
  } else if (detail.kind === 'festival') {
    // Festival shows store the festival name on production_name; the
    // lineup is the union of real headliner artists + support. Defensive
    // filter: drop any row whose name matches the festival name (legacy
    // data from before migration 0052 may still ship a phantom
    // "festival-name" headliner row).
    title = detail.productionName ?? performers.find((p) => p.role === 'headliner')?.performer.name ?? '';
    const titleNorm = title.trim().toLowerCase();
    lineup = performers.filter((p) => {
      if (titleNorm.length === 0) return true;
      return p.performer.name.trim().toLowerCase() !== titleNorm;
    });
  } else {
    // Concert / comedy: first headliner is the title; everyone else is support.
    title = performers.find((p) => p.role === 'headliner')?.performer.name ?? '';
    lineup = performers.filter((p) => p.role !== 'headliner');
  }

  const rows: PerformerRow[] = lineup.map((p) => ({
    id: newRowId(),
    name: p.performer.name,
    characterName: p.characterName ?? undefined,
    tier: p.role === 'headliner' ? 'headliner' : 'support',
    tmAttractionId: p.performer.ticketmasterAttractionId ?? undefined,
    wikidataQid: p.performer.wikidataQid ?? undefined,
    musicbrainzId: p.performer.musicbrainzId ?? undefined,
    imageUrl: p.performer.imageUrl ?? undefined,
  }));

  return {
    kind: detail.kind,
    title,
    venueQuery: detail.venue.name,
    venue: {
      id: detail.venue.id,
      name: detail.venue.name,
      city: detail.venue.city,
      stateRegion: detail.venue.stateRegion ?? null,
      country: detail.venue.country ?? null,
    },
    date: detail.date ?? '',
    endDate: detail.endDate ?? '',
    seat: detail.seat ?? '',
    pricePaid: detail.pricePaid ?? '',
    ticketCount: String(detail.ticketCount ?? 1),
    tourName: detail.tourName ?? '',
    notes: detail.notes ?? '',
    performers: rows,
  };
}

/**
 * Default seed for an empty `add` form.
 */
export function emptyShowFormValues(initial: Partial<ShowFormValues> = {}): ShowFormValues {
  return {
    kind: 'concert',
    title: '',
    venueQuery: '',
    venue: null,
    date: '',
    endDate: '',
    seat: '',
    pricePaid: '',
    ticketCount: '1',
    tourName: '',
    notes: '',
    performers: [],
    ...initial,
  };
}
