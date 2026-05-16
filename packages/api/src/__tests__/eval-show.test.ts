/**
 * Pure-helper suite for `evaluateShow`. The full DB-bound back-test runs
 * in the @showbook/jobs integration test; this file tests the math shape
 * — the per-show row schema, hit-flag derivation, top-K behaviour.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateShow } from '../eval-show';

const baseInput = {
  tourSetlistId: 'fake-tour-setlist',
  performerId: 'fake-performer',
  performerName: 'Fake',
  performanceDate: '2026-05-01',
  sampleSize: 14,
  style: 'stable' as const,
};

describe('evaluateShow — per-show row math', () => {
  test('hit flag is correct for every predicted song', () => {
    const result = evaluateShow({
      ...baseInput,
      predicted: [
        { title: 'A', probability: 0.95 },
        { title: 'B', probability: 0.85 },
        { title: 'Wildcard', probability: 0.2 },
      ],
      actualTitles: ['A', 'C'],
    });
    const byTitle = new Map(result.predicted.map((p) => [p.title, p.hit]));
    assert.equal(byTitle.get('A'), true);
    assert.equal(byTitle.get('B'), false);
    assert.equal(byTitle.get('Wildcard'), false);
  });

  test('persists every predicted song (not just hits)', () => {
    const result = evaluateShow({
      ...baseInput,
      predicted: [
        { title: 'A', probability: 0.9 },
        { title: 'B', probability: 0.3 },
        { title: 'C', probability: 0.05 },
      ],
      actualTitles: ['A'],
    });
    assert.equal(result.predicted.length, 3);
    assert.deepEqual(result.actual, ['A']);
  });

  test('precision@10 and recall@15 align with the underlying helpers', () => {
    const result = evaluateShow({
      ...baseInput,
      predicted: [
        { title: 'A', probability: 0.95 },
        { title: 'B', probability: 0.85 },
        { title: 'C', probability: 0.75 },
        { title: 'D', probability: 0.4 },
      ],
      actualTitles: ['A', 'B', 'D'],
    });
    // top-10 = all four predicted. Hits among them: A, B, D → 3/4
    assert.equal(result.precisionTop10, 3 / 4);
    // top-15 hits 3, actual has 3 → recall 1
    assert.equal(result.recallTop15, 1);
    // recallActual: 3 of the 3 actual were in the predicted set → 1
    assert.equal(result.recallActual, 1);
  });
});
