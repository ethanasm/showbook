import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inferKind, type TMEvent } from '../ticketmaster';

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

test('inferKind preserves existing non-music mappings', () => {
  assert.equal(
    inferKind([
      classification({
        segment: { ...SEGMENT.sports },
        genre: { id: 'g1', name: 'Basketball' },
      }),
    ]),
    'sports',
  );
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
