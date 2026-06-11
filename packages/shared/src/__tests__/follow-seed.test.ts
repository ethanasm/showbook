import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveFollowSuggestions,
  type FollowSeedShowLike,
} from '../utils/follow-seed';

function concertShow(partial: Partial<FollowSeedShowLike> = {}): FollowSeedShowLike {
  return {
    kind: 'concert',
    venue: { id: 'venue-1', name: 'Madison Square Garden', city: 'New York' },
    showPerformers: [
      {
        role: 'headliner',
        sortOrder: 0,
        performer: { id: 'perf-1', name: 'Radiohead' },
      },
      {
        role: 'support',
        sortOrder: 1,
        performer: { id: 'perf-2', name: 'Opener' },
      },
    ],
    ...partial,
  };
}

test('suggests the headliner and venue for a concert', () => {
  const result = deriveFollowSuggestions(concertShow());
  assert.deepEqual(result.performer, { id: 'perf-1', name: 'Radiohead' });
  assert.deepEqual(result.venue, { id: 'venue-1', name: 'Madison Square Garden' });
});

test('picks the lowest-sortOrder headliner when several carry the role', () => {
  const result = deriveFollowSuggestions(
    concertShow({
      showPerformers: [
        { role: 'headliner', sortOrder: 2, performer: { id: 'perf-b', name: 'Second' } },
        { role: 'headliner', sortOrder: 0, performer: { id: 'perf-a', name: 'First' } },
      ],
    }),
  );
  assert.equal(result.performer?.id, 'perf-a');
});

test('skips performers already followed', () => {
  const result = deriveFollowSuggestions(concertShow(), {
    followedPerformerIds: ['perf-1'],
  });
  assert.equal(result.performer, null);
  assert.equal(result.venue?.id, 'venue-1');
});

test('skips venues already followed', () => {
  const result = deriveFollowSuggestions(concertShow(), {
    followedVenueIds: ['venue-1'],
  });
  assert.equal(result.performer?.id, 'perf-1');
  assert.equal(result.venue, null);
});

test('comedy headliners are followable', () => {
  const result = deriveFollowSuggestions(concertShow({ kind: 'comedy' }));
  assert.equal(result.performer?.id, 'perf-1');
});

test('theatre and festival shows only suggest the venue', () => {
  for (const kind of ['theatre', 'festival']) {
    const result = deriveFollowSuggestions(concertShow({ kind }));
    assert.equal(result.performer, null, `${kind} should not suggest a performer`);
    assert.equal(result.venue?.id, 'venue-1');
  }
});

test('ignores the chat quick-save placeholder venue', () => {
  for (const venue of [
    { id: 'v', name: 'Unknown Venue', city: 'New York' },
    { id: 'v', name: 'The Greek', city: 'Unknown' },
    { id: 'v', name: 'The Greek', city: null },
    { id: 'v', name: '', city: 'Oakland' },
  ]) {
    const result = deriveFollowSuggestions(concertShow({ venue }));
    assert.equal(result.venue, null, `${venue.name} / ${venue.city} should be skipped`);
  }
});

test('handles a show with no performers or venue', () => {
  const result = deriveFollowSuggestions({ kind: 'concert', venue: null, showPerformers: null });
  assert.equal(result.performer, null);
  assert.equal(result.venue, null);
});

test('support-only lineups produce no performer suggestion', () => {
  const result = deriveFollowSuggestions(
    concertShow({
      showPerformers: [
        { role: 'support', sortOrder: 0, performer: { id: 'perf-2', name: 'Opener' } },
      ],
    }),
  );
  assert.equal(result.performer, null);
});
