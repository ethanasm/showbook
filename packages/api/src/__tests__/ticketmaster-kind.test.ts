import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractFestivalName, inferKind, type TMEvent } from '../ticketmaster';

type Classifications = NonNullable<TMEvent['classifications']>;
type Classification = Classifications[number];

// Stable TM IDs duplicated from ticketmaster.ts so the tests pin the
// production code to the same constants without exporting internals.
const SEGMENT = {
  music: { id: 'KZFzniwnSyZfZ7v7nJ', name: 'Music' },
  sports: { id: 'KZFzniwnSyZfZ7v7nE', name: 'Sports' },
  artsTheatre: { id: 'KZFzniwnSyZfZ7v7na', name: 'Arts & Theatre' },
  film: { id: 'KZFzniwnSyZfZ7v7nn', name: 'Film' },
  miscellaneous: { id: 'KZFzniwnSyZfZ7v7n1', name: 'Miscellaneous' },
} as const;

const GENRE_COMEDY_ID = 'KnvZfZ7vAe1';

function classification(overrides: Partial<Classification>): Classification {
  return {
    primary: true,
    segment: { ...SEGMENT.music },
    genre: { id: 'KnvZfZ7vAeA', name: 'Rock' },
    ...overrides,
  };
}

test('inferKind maps allowlisted music festivals by event name', () => {
  assert.equal(
    inferKind([classification({})], { eventName: 'Outside-Lands' }),
    'festival',
  );
});

test('inferKind keeps ordinary music events as concerts', () => {
  assert.equal(
    inferKind([classification({})], { eventName: 'Japanese Breakfast' }),
    'concert',
  );
});

test('inferKind maps music classification festival signals to festival', () => {
  assert.equal(
    inferKind([classification({ genre: { id: 'g1', name: 'Festival' } })]),
    'festival',
  );
  assert.equal(
    inferKind([classification({ subGenre: { id: 'sg1', name: 'Music Festival' } })]),
    'festival',
  );
  assert.equal(
    inferKind([classification({ type: { id: 't1', name: 'Festival' } })]),
    'festival',
  );
  assert.equal(
    inferKind([classification({ subType: { id: 'st1', name: 'Festival Pass' } })]),
    'festival',
  );
});

test('inferKind checks non-primary classifications for festival signals', () => {
  assert.equal(
    inferKind([
      classification({ primary: true, genre: { id: 'g1', name: 'Rock' } }),
      classification({
        primary: false,
        genre: { id: 'g2', name: 'Festival' },
      }),
    ]),
    'festival',
  );
});

test('inferKind buckets TM sports-segment events as unknown', () => {
  // The 'sports' kind was removed; TM's Sports segment now falls through
  // to the 'unknown' default and is dropped by the ingest normalizer.
  assert.equal(
    inferKind([
      classification({
        segment: { ...SEGMENT.sports },
        genre: { id: 'g1', name: 'Basketball' },
      }),
    ]),
    'unknown',
  );
});

test('inferKind preserves existing non-music mappings', () => {
  assert.equal(
    inferKind([
      classification({
        segment: { ...SEGMENT.artsTheatre },
        genre: { id: GENRE_COMEDY_ID, name: 'Comedy' },
      }),
    ]),
    'comedy',
  );
  assert.equal(
    inferKind([
      classification({
        segment: { ...SEGMENT.artsTheatre },
        genre: { id: 'KnvZfZ7v7l1', name: 'Theatre' },
      }),
    ]),
    'theatre',
  );
});

// Regression tests for the Orpheum Theatre miscategorisation. Touring stage
// productions came back from TM with Arts & Theatre segment but with genre
// labels that don't contain the literal substring "musical"/"theatre" —
// previously fell through to "concert".
test('inferKind: Arts & Theatre with an unfamiliar genre label maps to theatre by segment ID', () => {
  // genre name "Theatrical Production" — does not contain "theatre" /
  // "musical" / "theater" as a substring, but segment ID is the source of
  // truth.
  assert.equal(
    inferKind([
      classification({
        segment: { ...SEGMENT.artsTheatre },
        genre: { id: 'KnvZfZ7v7lJ', name: 'Theatrical Production' },
      }),
    ]),
    'theatre',
  );
  assert.equal(
    inferKind([
      classification({
        segment: { ...SEGMENT.artsTheatre },
        genre: { id: 'KnvZfZ7v7lk', name: 'Performance Art' },
      }),
    ]),
    'theatre',
  );
});

test('inferKind: Arts & Theatre with no genre at all maps to theatre', () => {
  assert.equal(
    inferKind([classification({ segment: { ...SEGMENT.artsTheatre }, genre: undefined })]),
    'theatre',
  );
});

test('inferKind: Arts & Theatre comedy keyed by genre ID even if name is unusual', () => {
  // Stand-up specials are sometimes labelled with non-obvious genre names
  // but always carry the canonical Comedy genre ID.
  assert.equal(
    inferKind([
      classification({
        segment: { ...SEGMENT.artsTheatre },
        genre: { id: GENRE_COMEDY_ID, name: 'Stand-Up' },
      }),
    ]),
    'comedy',
  );
});

test('inferKind: Film segment maps to film', () => {
  assert.equal(
    inferKind([classification({ segment: { ...SEGMENT.film }, genre: undefined })]),
    'film',
  );
});

test('inferKind: Miscellaneous segment falls back to unknown, not concert', () => {
  // We don't have a watchable kind for Misc; surface as "unknown" so it
  // shows up on Discover but can't be added to a watchlist.
  assert.equal(
    inferKind([classification({ segment: { ...SEGMENT.miscellaneous }, genre: undefined })]),
    'unknown',
  );
});

test('inferKind: empty / missing classifications surface as unknown', () => {
  // The previous default of "concert" silently mislabelled events whose
  // TM payload had no classification block at all.
  assert.equal(inferKind(undefined), 'unknown');
  assert.equal(inferKind([]), 'unknown');
});

// Outside Lands 2026 regression: TM returns the per-day events with NO music
// classification (they fall into the miscellaneous "unknown" bucket), so the
// pre-fix knownFestivalNames check — which lived inside the music segment
// branch — never fired. Festival detection must work regardless of segment.
test('inferKind: known festival name overrides missing classification', () => {
  assert.equal(
    inferKind(undefined, { eventName: 'Outside Lands 2026 - Friday Single Day' }),
    'festival',
  );
  assert.equal(
    inferKind([], { eventName: 'Outside Lands' }),
    'festival',
  );
});

test('inferKind: known festival name overrides miscellaneous segment', () => {
  assert.equal(
    inferKind(
      [classification({ segment: { ...SEGMENT.miscellaneous }, genre: undefined })],
      { eventName: 'Outside Lands 2026 - Saturday' },
    ),
    'festival',
  );
});

test('inferKind: festival genre/subGenre wins outside the music segment too', () => {
  // Some festivals come back with genre "Festival" on a non-music segment
  // (TM's "Multi-Event" / promoter listings). Trust the label.
  assert.equal(
    inferKind([
      classification({
        segment: { ...SEGMENT.miscellaneous },
        genre: { id: 'g1', name: 'Festival' },
      }),
    ]),
    'festival',
  );
});

test('extractFestivalName strips year + day suffix from real TM names', () => {
  // TM lists multi-day festivals with one event per day-pass variant,
  // each named with a year and day-of-week suffix. extractFestivalName
  // is what normalizeTmEvent uses to give them a shared headliner so
  // groupEventsIntoRuns can collapse them.
  assert.equal(
    extractFestivalName('Outside Lands 2026 - Friday Single Day'),
    'Outside Lands',
  );
  assert.equal(
    extractFestivalName('Outside Lands 2026 - Saturday'),
    'Outside Lands',
  );
  assert.equal(
    extractFestivalName('Outside Lands 2026 - 3 Day GA Pass'),
    'Outside Lands',
  );
  assert.equal(extractFestivalName('Outside Lands 2026'), 'Outside Lands');
});

test('extractFestivalName: en-dash and pipe separators both split', () => {
  assert.equal(
    extractFestivalName('Coachella 2026 – Weekend 1'),
    'Coachella',
  );
  assert.equal(
    extractFestivalName('Bonnaroo 2026 | Day Pass'),
    'Bonnaroo',
  );
});

test('extractFestivalName: falls back to original name when stripping empties it', () => {
  // No separator, no year, no day token — return as-is so the headliner
  // is never empty.
  assert.equal(extractFestivalName('Outside Lands'), 'Outside Lands');
  assert.equal(extractFestivalName('Lollapalooza'), 'Lollapalooza');
});

test('extractFestivalName: collapses Outside Lands name variants to one cluster key', () => {
  // TM returns the same festival under three different name patterns:
  // the canonical daily-lineup form, the per-day "Platinum" ticket-tier
  // listings (split on `-` first), and the long-form promoter listing
  // ("Music & Arts Festival"). All three must land on the same headliner
  // string so groupEventsIntoRuns produces one cluster instead of three.
  assert.equal(
    extractFestivalName('Outside Lands Festival - FRIDAY Platinum'),
    'Outside Lands',
  );
  assert.equal(
    extractFestivalName('Outside Lands Festival - 3-DAY Platinum'),
    'Outside Lands',
  );
  assert.equal(
    extractFestivalName('Outside Lands Music & Arts Festival'),
    'Outside Lands',
  );
  assert.equal(
    extractFestivalName('Outside Lands Music and Arts Festival'),
    'Outside Lands',
  );
});

test('extractFestivalName: strips a lone "Festival" suffix from a single-word prefix', () => {
  // Real festivals are often single-word ("Lollapalooza", "Coachella");
  // when TM dresses them with a "Festival" suffix we still want them to
  // cluster against the bare name.
  assert.equal(extractFestivalName('Lollapalooza Festival'), 'Lollapalooza');
  assert.equal(extractFestivalName('Coachella Fest'), 'Coachella');
});

test('extractFestivalName: bare "Festival" / "Fest" returns the original (no leading word to anchor to)', () => {
  // No leading whitespace → the suffix-strip regex doesn't fire, so we
  // keep the original instead of returning an empty string.
  assert.equal(extractFestivalName('Festival'), 'Festival');
  assert.equal(extractFestivalName('Fest'), 'Fest');
});
