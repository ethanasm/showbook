/**
 * Pure-helper suite for `summarizeRun`. Exercises the aggregation shape
 * without touching the DB. The DB-bound back-test is in
 * `prediction-eval.integration.test.ts`.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { emptyCalibrationCurve, calibrationBuckets } from '@showbook/api';
import { summarizeRun, type PerShowEvalRow } from '../prediction-eval';

function row(overrides: Partial<PerShowEvalRow>): PerShowEvalRow {
  return {
    tourSetlistId: 'ts',
    performerId: 'p',
    performerName: 'Perf',
    performanceDate: '2026-05-01',
    style: 'stable',
    brier: 0.1,
    precisionTop10: 0.5,
    recallActual: 0.5,
    recallTop15: 0.7,
    sampleSize: 14,
    predicted: [
      { title: 'A', probability: 0.9, hit: true },
      { title: 'B', probability: 0.4, hit: false },
    ],
    actual: ['A'],
    ...overrides,
  };
}

describe('summarizeRun', () => {
  test('empty rows produces a zero summary', () => {
    const summary = summarizeRun([], emptyCalibrationCurve(10));
    assert.equal(summary.predictionCount, 0);
    assert.equal(summary.brierScore, 0);
    assert.equal(summary.byStyle.length, 0);
  });

  test('averages metrics across rows', () => {
    const summary = summarizeRun(
      [
        row({ brier: 0.1, precisionTop10: 0.6, recallTop15: 0.5 }),
        row({ brier: 0.3, precisionTop10: 0.4, recallTop15: 0.9 }),
      ],
      emptyCalibrationCurve(10),
    );
    assert.equal(summary.brierScore, 0.2);
    assert.equal(summary.precisionTop10, 0.5);
    assert.equal(summary.recallTop15, 0.7);
  });

  test('groups by style and produces a per-style entry', () => {
    const summary = summarizeRun(
      [
        row({ style: 'stable', brier: 0.1, predicted: [{ title: 'X', probability: 1, hit: true }] }),
        row({ style: 'stable', brier: 0.2, predicted: [{ title: 'Y', probability: 1, hit: false }] }),
      ],
      calibrationBuckets({
        predicted: [
          { title: 'X', probability: 1 },
          { title: 'Y', probability: 1 },
        ],
        actualTitles: ['X'],
      }),
    );
    const stable = summary.byStyle.find((s) => s.style === 'stable');
    assert.ok(stable);
    assert.ok(Math.abs(stable!.brier - 0.15) < 1e-9);
    assert.equal(stable!.predictions, 2);
  });

  test('Phase 6 — surfaces theatrical bucket separately from stable', () => {
    const summary = summarizeRun(
      [
        row({ style: 'stable', brier: 0.1 }),
        row({ style: 'theatrical', brier: 0.05, performerId: 'beyonce' }),
        row({ style: 'theatrical', brier: 0.07, performerId: 'beyonce' }),
      ],
      emptyCalibrationCurve(10),
    );
    const theatrical = summary.byStyle.find((s) => s.style === 'theatrical');
    assert.ok(theatrical);
    assert.equal(theatrical!.predictions, 4); // 2 rows × 2 predicted titles each
    assert.ok(Math.abs(theatrical!.brier - 0.06) < 1e-9);
  });

  test('counts predicted-song totals not row totals', () => {
    const summary = summarizeRun(
      [
        row({
          predicted: [
            { title: 'A', probability: 0.9, hit: true },
            { title: 'B', probability: 0.5, hit: false },
            { title: 'C', probability: 0.1, hit: false },
          ],
        }),
        row({
          predicted: [
            { title: 'D', probability: 0.8, hit: false },
            { title: 'E', probability: 0.3, hit: false },
          ],
        }),
      ],
      emptyCalibrationCurve(10),
    );
    assert.equal(summary.predictionCount, 5);
  });
});
