/**
 * Pure-function tests for groupEventsIntoRuns. Runnable via:
 *   pnpm --filter @showbook/jobs exec node --import tsx --test src/__tests__/run-grouping.test.ts
 *
 * No DB or browser required — these protect the most consequential new
 * logic (theatre always groups; concerts only group as residencies; festivals
 * collapse duplicate pass/day listings; comedy never groups; run dates /
 * source IDs / on-sale status aggregate correctly).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupEventsIntoRuns, shouldGroup, type NormalizedEvent } from '../run-grouping';

function makeEvent(overrides: Partial<NormalizedEvent>): NormalizedEvent {
  return {
    sourceEventId: overrides.sourceEventId ?? `id-${Math.random()}`,
    date: overrides.date ?? '2026-08-01',
    kind: overrides.kind ?? 'theatre',
    headliner: overrides.headliner ?? 'Hamilton',
    headlinerPerformerId: overrides.headlinerPerformerId ?? 'hamilton-perf',
    venueId: overrides.venueId ?? 'majestic-venue',
    support: overrides.support ?? null,
    supportPerformerIds: overrides.supportPerformerIds ?? null,
    onSaleDate: overrides.onSaleDate ?? null,
    onSaleStatus: overrides.onSaleStatus ?? 'on_sale',
    source: overrides.source ?? 'ticketmaster',
    ticketUrl: overrides.ticketUrl ?? null,
  };
}

test('shouldGroup: theatre always groups when 2+ dates', () => {
  assert.equal(shouldGroup('theatre', ['2026-08-01', '2026-08-02']), true);
  assert.equal(shouldGroup('theatre', ['2026-08-01']), false);
  assert.equal(
    shouldGroup('theatre', [
      '2026-08-01',
      '2026-09-01',
      '2026-12-15',
    ]),
    true,
  );
});

test('shouldGroup: concerts group only with 3+ dates within 30 days', () => {
  // Two dates: never
  assert.equal(shouldGroup('concert', ['2026-08-01', '2026-08-02']), false);
  // 3+ within 30 days: yes (residency)
  assert.equal(
    shouldGroup('concert', ['2026-08-01', '2026-08-15', '2026-08-25']),
    true,
  );
  // 3 dates spanning more than 30 days: no (touring)
  assert.equal(
    shouldGroup('concert', ['2026-08-01', '2026-09-15', '2026-10-30']),
    false,
  );
});

test('shouldGroup: comedy never groups, festivals group duplicate listings', () => {
  assert.equal(
    shouldGroup('comedy', ['2026-08-01', '2026-08-02', '2026-08-03']),
    false,
  );
  assert.equal(
    shouldGroup('festival', ['2026-08-01', '2026-08-02']),
    true,
  );
});

test('groupEventsIntoRuns: 90 theatre nights collapse into one run', () => {
  const dates: string[] = [];
  const start = new Date('2026-08-01');
  for (let i = 0; i < 90; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    dates.push(d.toISOString().slice(0, 10));
  }
  const events = dates.map((d, i) =>
    makeEvent({ date: d, sourceEventId: `night-${i}` }),
  );

  const { runs, singles } = groupEventsIntoRuns(events);

  assert.equal(runs.length, 1, 'one run produced');
  assert.equal(singles.length, 0, 'no singles');

  const run = runs[0]!;
  assert.equal(run.runStartDate, '2026-08-01');
  assert.equal(run.runEndDate, dates[89]);
  assert.equal(run.performanceDates.length, 90);
  assert.equal(run.sourceEventIds.length, 90);
  assert.equal(run.productionName, 'Hamilton');
  assert.equal(run.kind, 'theatre');
});

test('groupEventsIntoRuns: 2 theatre nights still group (matches plan)', () => {
  const events = [
    makeEvent({ date: '2026-08-01', sourceEventId: 'a' }),
    makeEvent({ date: '2026-08-02', sourceEventId: 'b' }),
  ];
  const { runs, singles } = groupEventsIntoRuns(events);
  assert.equal(runs.length, 1);
  assert.equal(singles.length, 0);
});

test('groupEventsIntoRuns: single concert at a venue stays a single', () => {
  const events = [
    makeEvent({
      date: '2026-08-01',
      kind: 'concert',
      headliner: 'Radiohead',
      headlinerPerformerId: 'radiohead-perf',
    }),
  ];
  const { runs, singles } = groupEventsIntoRuns(events);
  assert.equal(runs.length, 0);
  assert.equal(singles.length, 1);
});

test('groupEventsIntoRuns: 3-night concert residency within 30d groups', () => {
  const events = [
    makeEvent({
      date: '2026-08-01',
      kind: 'concert',
      headliner: 'Stevie Nicks',
      headlinerPerformerId: 'sn',
      sourceEventId: 'r1',
    }),
    makeEvent({
      date: '2026-08-08',
      kind: 'concert',
      headliner: 'Stevie Nicks',
      headlinerPerformerId: 'sn',
      sourceEventId: 'r2',
    }),
    makeEvent({
      date: '2026-08-22',
      kind: 'concert',
      headliner: 'Stevie Nicks',
      headlinerPerformerId: 'sn',
      sourceEventId: 'r3',
    }),
  ];
  const { runs, singles } = groupEventsIntoRuns(events);
  assert.equal(runs.length, 1);
  assert.equal(singles.length, 0);
  assert.equal(runs[0]!.performanceDates.length, 3);
});

test('groupEventsIntoRuns: 3-night concert tour spanning 60 days does NOT group', () => {
  const events = [
    makeEvent({
      date: '2026-08-01',
      kind: 'concert',
      headliner: 'Taylor Swift',
      headlinerPerformerId: 'ts',
      sourceEventId: 'tour1',
    }),
    makeEvent({
      date: '2026-09-15',
      kind: 'concert',
      headliner: 'Taylor Swift',
      headlinerPerformerId: 'ts',
      sourceEventId: 'tour2',
    }),
    makeEvent({
      date: '2026-10-30',
      kind: 'concert',
      headliner: 'Taylor Swift',
      headlinerPerformerId: 'ts',
      sourceEventId: 'tour3',
    }),
  ];
  const { runs, singles } = groupEventsIntoRuns(events);
  assert.equal(runs.length, 0);
  assert.equal(singles.length, 3);
});

test('groupEventsIntoRuns: comedy nights stay separate even at the same venue', () => {
  const events = [
    makeEvent({
      date: '2026-08-01',
      kind: 'comedy',
      headliner: 'John Mulaney',
      headlinerPerformerId: 'jm',
    }),
    makeEvent({
      date: '2026-08-02',
      kind: 'comedy',
      headliner: 'John Mulaney',
      headlinerPerformerId: 'jm',
    }),
    makeEvent({
      date: '2026-08-03',
      kind: 'comedy',
      headliner: 'John Mulaney',
      headlinerPerformerId: 'jm',
    }),
  ];
  const { runs, singles } = groupEventsIntoRuns(events);
  assert.equal(runs.length, 0);
  assert.equal(singles.length, 3);
});

test('groupEventsIntoRuns: festival pass and day listings collapse into one representative run', () => {
  const events = [
    makeEvent({
      date: '2026-08-07',
      kind: 'festival',
      headliner: 'Outside Lands',
      headlinerPerformerId: 'outside-lands',
      sourceEventId: 'three-day-friday',
      support: ['Charli xcx', 'Turnstile', 'GloRilla'],
      onSaleDate: new Date('2026-03-05T20:00:00Z'),
      onSaleStatus: 'sold_out',
      ticketUrl: 'https://on.fgtix.com/trk/sILM',
    }),
    makeEvent({
      date: '2026-08-07',
      kind: 'festival',
      headliner: 'Outside Lands',
      headlinerPerformerId: 'outside-lands',
      sourceEventId: 'friday-platinum',
      support: null,
      onSaleDate: new Date('2026-03-25T00:00:00Z'),
      onSaleStatus: 'on_sale',
      ticketUrl: 'https://ticketmaster.example/friday-platinum',
    }),
    makeEvent({
      date: '2026-08-08',
      kind: 'festival',
      headliner: 'Outside Lands',
      headlinerPerformerId: 'outside-lands',
      sourceEventId: 'three-day-saturday',
      support: ['The Strokes', 'The xx', 'Ethel Cain'],
      onSaleDate: new Date('2026-03-05T20:00:00Z'),
      onSaleStatus: 'sold_out',
      ticketUrl: 'https://on.fgtix.com/trk/sILM',
    }),
    makeEvent({
      date: '2026-08-09',
      kind: 'festival',
      headliner: 'Outside Lands',
      headlinerPerformerId: 'outside-lands',
      sourceEventId: 'three-day-sunday',
      support: ['RUFUS DU SOL', 'Baby Keem'],
      onSaleDate: new Date('2026-03-05T20:00:00Z'),
      onSaleStatus: 'sold_out',
      ticketUrl: 'https://on.fgtix.com/trk/sILM',
    }),
  ];

  const { runs, singles } = groupEventsIntoRuns(events);

  assert.equal(runs.length, 1);
  assert.equal(singles.length, 0);
  assert.deepEqual(runs[0]!.performanceDates, [
    '2026-08-07',
    '2026-08-08',
    '2026-08-09',
  ]);
  assert.equal(runs[0]!.kind, 'festival');
  assert.equal(runs[0]!.onSaleStatus, 'sold_out');
  assert.equal(runs[0]!.ticketUrl, 'https://on.fgtix.com/trk/sILM');
  assert.equal(runs[0]!.sourceEventIds.length, 4);
});

test('groupEventsIntoRuns: different venues for same artist do not merge', () => {
  const events = [
    makeEvent({
      date: '2026-08-01',
      kind: 'theatre',
      headliner: 'Hamilton',
      headlinerPerformerId: 'h',
      venueId: 'majestic',
    }),
    makeEvent({
      date: '2026-09-01',
      kind: 'theatre',
      headliner: 'Hamilton',
      headlinerPerformerId: 'h',
      venueId: 'shubert',
    }),
  ];
  const { runs, singles } = groupEventsIntoRuns(events);
  // Each venue has one date, neither qualifies as a run.
  assert.equal(runs.length, 0);
  assert.equal(singles.length, 2);
});

test('groupEventsIntoRuns: dedups duplicate performance dates', () => {
  // Real ingest can emit the same date twice if TM has two events for one
  // physical performance. The grouper should collapse to unique dates.
  const events = [
    makeEvent({ date: '2026-08-01', sourceEventId: 'a' }),
    makeEvent({ date: '2026-08-01', sourceEventId: 'b' }),
    makeEvent({ date: '2026-08-02', sourceEventId: 'c' }),
  ];
  const { runs } = groupEventsIntoRuns(events);
  assert.equal(runs.length, 1);
  assert.deepEqual(runs[0]!.performanceDates, ['2026-08-01', '2026-08-02']);
  // Source IDs preserved (3) so dedup of subsequent runs works.
  assert.equal(runs[0]!.sourceEventIds.length, 3);
});

test('groupEventsIntoRuns: on-sale status across run picks "on_sale" if any', () => {
  const events = [
    makeEvent({
      date: '2026-08-01',
      onSaleStatus: 'announced',
      sourceEventId: 'a',
    }),
    makeEvent({
      date: '2026-08-02',
      onSaleStatus: 'on_sale',
      sourceEventId: 'b',
    }),
    makeEvent({
      date: '2026-08-03',
      onSaleStatus: 'sold_out',
      sourceEventId: 'c',
    }),
  ];
  const { runs } = groupEventsIntoRuns(events);
  assert.equal(runs[0]!.onSaleStatus, 'on_sale');
});

test('groupEventsIntoRuns: on-sale status sold_out only when ALL nights sold out', () => {
  const events = [
    makeEvent({
      date: '2026-08-01',
      onSaleStatus: 'sold_out',
      sourceEventId: 'a',
    }),
    makeEvent({
      date: '2026-08-02',
      onSaleStatus: 'sold_out',
      sourceEventId: 'b',
    }),
  ];
  const { runs } = groupEventsIntoRuns(events);
  assert.equal(runs[0]!.onSaleStatus, 'sold_out');
});

test('groupEventsIntoRuns: earliest on-sale date across the run is used', () => {
  const events = [
    makeEvent({
      date: '2026-08-01',
      onSaleDate: new Date('2026-04-15T00:00:00Z'),
      sourceEventId: 'a',
    }),
    makeEvent({
      date: '2026-08-02',
      onSaleDate: new Date('2026-03-01T00:00:00Z'),
      sourceEventId: 'b',
    }),
    makeEvent({
      date: '2026-08-03',
      onSaleDate: null,
      sourceEventId: 'c',
    }),
  ];
  const { runs } = groupEventsIntoRuns(events);
  assert.equal(runs[0]!.onSaleDate?.toISOString(), '2026-03-01T00:00:00.000Z');
});
