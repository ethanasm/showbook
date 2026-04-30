import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inferKind, type TMEvent } from '../ticketmaster';

type Classifications = NonNullable<TMEvent['classifications']>;
type Classification = Classifications[number];

function classification(overrides: Partial<Classification>): Classification {
  return {
    primary: true,
    segment: { id: 'KZFzniwnSyZfZ7v7nJ', name: 'Music' },
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
        segment: { id: 's1', name: 'Sports' },
        genre: { id: 'g1', name: 'Basketball' },
      }),
    ]),
    'sports',
  );
  assert.equal(
    inferKind([
      classification({
        segment: { id: 's2', name: 'Arts & Theatre' },
        genre: { id: 'g2', name: 'Comedy' },
      }),
    ]),
    'comedy',
  );
  assert.equal(
    inferKind([
      classification({
        segment: { id: 's2', name: 'Arts & Theatre' },
        genre: { id: 'g3', name: 'Musical' },
      }),
    ]),
    'theatre',
  );
});
