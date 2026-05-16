/**
 * Pure-math suite for the Phase 4 eval-metrics helpers. Hand-computed
 * cases drive each function so a regression in (say) probability binning
 * or top-K ranking fails loudly. Mirrors the Phase 4 plan's expectation
 * that "Brier + P@10 + calibration math is unit-tested against
 * hand-computed cases."
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  approxEq,
  brierScore,
  calibrationBuckets,
  calibrationError,
  emptyCalibrationCurve,
  mergeCalibrationBuckets,
  precisionAtK,
  recallActual,
  recallAtK,
} from '../eval-metrics';

describe('brierScore', () => {
  test('perfect prediction scores 0', () => {
    const score = brierScore({
      predicted: [
        { title: 'A', probability: 1 },
        { title: 'B', probability: 0 },
      ],
      actualTitles: ['A'],
    });
    assert.equal(score, 0);
  });

  test('worst-case prediction scores 1', () => {
    const score = brierScore({
      predicted: [
        { title: 'A', probability: 0 },
        { title: 'B', probability: 1 },
      ],
      actualTitles: ['A'],
    });
    // ((0-1)^2 + (1-0)^2) / 2 = 1
    assert.equal(score, 1);
  });

  test('mixed case matches hand computation', () => {
    // Predicted: A=0.8, B=0.3. Actual: ['A']
    // Brier = ((0.8 - 1)^2 + (0.3 - 0)^2) / 2 = (0.04 + 0.09) / 2 = 0.065
    const score = brierScore({
      predicted: [
        { title: 'A', probability: 0.8 },
        { title: 'B', probability: 0.3 },
      ],
      actualTitles: ['A'],
    });
    assert.ok(approxEq(score, 0.065), `expected 0.065, got ${score}`);
  });

  test('case-insensitive title matching', () => {
    const score = brierScore({
      predicted: [{ title: 'Heroes', probability: 1 }],
      actualTitles: ['heroes'],
    });
    assert.equal(score, 0);
  });

  test('empty predicted set returns 0 (no signal)', () => {
    const score = brierScore({ predicted: [], actualTitles: ['A'] });
    assert.equal(score, 0);
  });
});

describe('precisionAtK', () => {
  test('top-3 with 2 hits → 2/3', () => {
    const p = precisionAtK({
      predicted: [
        { title: 'A', probability: 0.9 },
        { title: 'B', probability: 0.85 },
        { title: 'C', probability: 0.8 },
        { title: 'D', probability: 0.1 },
      ],
      actualTitles: ['A', 'C', 'Z'],
      k: 3,
    });
    assert.ok(approxEq(p, 2 / 3));
  });

  test('K larger than predicted set caps at predicted.length', () => {
    const p = precisionAtK({
      predicted: [{ title: 'A', probability: 0.9 }],
      actualTitles: ['A', 'B'],
      k: 10,
    });
    assert.equal(p, 1);
  });

  test('zero K returns 0', () => {
    const p = precisionAtK({
      predicted: [{ title: 'A', probability: 0.9 }],
      actualTitles: ['A'],
      k: 0,
    });
    assert.equal(p, 0);
  });

  test('ties broken deterministically by title (alphabetical)', () => {
    // Two songs tied at 0.5. With k=1 we keep the alphabetically-first
    // one only ("Apple"). Apple is in actual; Banana is not.
    const p = precisionAtK({
      predicted: [
        { title: 'Banana', probability: 0.5 },
        { title: 'Apple', probability: 0.5 },
      ],
      actualTitles: ['Apple'],
      k: 1,
    });
    assert.equal(p, 1);
  });
});

describe('recallAtK', () => {
  test('all 3 actual songs in the top-10 → recall 1', () => {
    const r = recallAtK({
      predicted: [
        { title: 'A', probability: 0.9 },
        { title: 'B', probability: 0.8 },
        { title: 'C', probability: 0.7 },
        { title: 'X', probability: 0.6 },
      ],
      actualTitles: ['A', 'B', 'C'],
      k: 10,
    });
    assert.equal(r, 1);
  });

  test('K trims off one actual song → recall 2/3', () => {
    const r = recallAtK({
      predicted: [
        { title: 'A', probability: 0.9 },
        { title: 'B', probability: 0.8 },
        { title: 'X', probability: 0.4 },
        { title: 'C', probability: 0.3 },
      ],
      actualTitles: ['A', 'B', 'C'],
      k: 3,
    });
    assert.ok(approxEq(r, 2 / 3));
  });

  test('empty actual setlist → 0', () => {
    const r = recallAtK({
      predicted: [{ title: 'A', probability: 1 }],
      actualTitles: [],
      k: 10,
    });
    assert.equal(r, 0);
  });
});

describe('recallActual', () => {
  test('predicted superset of actual → recall 1', () => {
    const r = recallActual({
      predicted: [
        { title: 'A', probability: 0.9 },
        { title: 'B', probability: 0.4 },
        { title: 'C', probability: 0.1 },
      ],
      actualTitles: ['A', 'B'],
    });
    assert.equal(r, 1);
  });

  test('half-coverage → 0.5', () => {
    const r = recallActual({
      predicted: [{ title: 'A', probability: 0.5 }],
      actualTitles: ['A', 'B'],
    });
    assert.equal(r, 0.5);
  });
});

describe('calibrationBuckets', () => {
  test('10-bin layout — each prediction lands in the expected decile', () => {
    const bins = calibrationBuckets({
      predicted: [
        { title: 'A', probability: 0.05 },  // bin 0 (0..0.1)
        { title: 'B', probability: 0.25 },  // bin 2 (0.2..0.3)
        { title: 'C', probability: 0.95 },  // bin 9 (0.9..1.0)
        { title: 'D', probability: 1.0 },   // bin 9 (clamped)
      ],
      actualTitles: ['A', 'D'],
    });
    assert.equal(bins.length, 10);
    assert.equal(bins[0]!.predictions, 1);
    assert.equal(bins[0]!.empiricalRate, 1);
    assert.equal(bins[2]!.predictions, 1);
    assert.equal(bins[2]!.empiricalRate, 0);
    assert.equal(bins[9]!.predictions, 2);
    assert.equal(bins[9]!.empiricalRate, 0.5);
  });

  test('mean probability in a bin is the average of inputs', () => {
    const bins = calibrationBuckets({
      predicted: [
        { title: 'A', probability: 0.22 },
        { title: 'B', probability: 0.28 },
      ],
      actualTitles: [],
    });
    // Both land in bin 2 (0.2..0.3). Mean = 0.25.
    assert.ok(approxEq(bins[2]!.meanProbability, 0.25));
  });

  test('empty input returns 10 zero bins', () => {
    const bins = calibrationBuckets({ predicted: [], actualTitles: [] });
    assert.equal(bins.length, 10);
    for (const b of bins) assert.equal(b.predictions, 0);
  });
});

describe('calibrationError', () => {
  test('perfect calibration → 0', () => {
    const bins = calibrationBuckets({
      predicted: [
        // Bin 0 (mean ~0.0): 0 hits/1 → empirical 0, mean ~0 → delta 0
        { title: 'A', probability: 0.0 },
        // Bin 9 (mean ~1.0): 1 hit/1 → empirical 1, mean 1 → delta 0
        { title: 'B', probability: 1.0 },
      ],
      actualTitles: ['B'],
    });
    assert.equal(calibrationError(bins), 0);
  });

  test('over-confident bin shows up as positive error', () => {
    const bins = calibrationBuckets({
      predicted: [
        { title: 'A', probability: 0.9 },
        { title: 'B', probability: 0.9 },
        { title: 'C', probability: 0.9 },
      ],
      actualTitles: ['A'], // 1 of 3 → empirical = 0.333, mean = 0.9 → delta = -0.566
    });
    const err = calibrationError(bins);
    assert.ok(approxEq(err, 0.5666666, 1e-3), `expected ~0.567, got ${err}`);
  });

  test('empty bins ignored', () => {
    const bins = emptyCalibrationCurve(10);
    assert.equal(calibrationError(bins), 0);
  });
});

describe('mergeCalibrationBuckets', () => {
  test('merging two single-prediction sets averages the means', () => {
    const a = calibrationBuckets({
      predicted: [{ title: 'A', probability: 0.95 }],
      actualTitles: ['A'],
    });
    const b = calibrationBuckets({
      predicted: [{ title: 'B', probability: 0.91 }],
      actualTitles: [],
    });
    const merged = mergeCalibrationBuckets(a, b);
    assert.equal(merged[9]!.predictions, 2);
    // (0.95 + 0.91) / 2 = 0.93
    assert.ok(approxEq(merged[9]!.meanProbability, 0.93));
    // 1 hit out of 2 → 0.5
    assert.ok(approxEq(merged[9]!.empiricalRate, 0.5));
  });

  test('empty curve passes through', () => {
    const a = emptyCalibrationCurve(10);
    const b = calibrationBuckets({
      predicted: [{ title: 'A', probability: 0.5 }],
      actualTitles: ['A'],
    });
    const merged = mergeCalibrationBuckets(a, b);
    assert.equal(merged[5]!.predictions, 1);
    assert.equal(merged[5]!.empiricalRate, 1);
  });

  test('mismatched lengths throw', () => {
    assert.throws(() =>
      mergeCalibrationBuckets(emptyCalibrationCurve(5), emptyCalibrationCurve(10)),
    );
  });
});
