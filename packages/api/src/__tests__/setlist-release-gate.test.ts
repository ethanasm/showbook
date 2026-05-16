/**
 * Unit suite for the Phase 5 calibration release-gate. Each test seeds
 * a synthetic run shape and asserts which threshold(s) the gate
 * verdict raises.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateReleaseGate,
  RELEASE_GATE_THRESHOLDS,
} from '../setlist-release-gate';

function calibrationCurve(deltas: number[]): Array<{
  lower: number;
  upper: number;
  predictions: number;
  meanProbability: number;
  empiricalRate: number;
  delta: number;
}> {
  return deltas.map((d, i) => ({
    lower: i / deltas.length,
    upper: (i + 1) / deltas.length,
    predictions: 10,
    meanProbability: (i + 0.5) / deltas.length,
    empiricalRate: (i + 0.5) / deltas.length + d,
    delta: d,
  }));
}

describe('evaluateReleaseGate', () => {
  test('passes when every threshold is met', () => {
    const verdict = evaluateReleaseGate({
      byStyle: [
        { style: 'stable', brier: 0.1, recallTop15: 0.9, predictions: 100 },
        { style: 'rotating', brier: 0.3, recallTop15: 0.6, predictions: 50 },
      ],
      calibrationCurve: calibrationCurve([0.0, 0.05, -0.1, 0.05, 0.0]),
    });
    assert.equal(verdict.passes, true);
    assert.equal(verdict.reasons.length, 0);
    assert.equal(verdict.rotatingEvaluable, true);
    assert.equal(verdict.stableEvaluable, true);
  });

  test('fails on stable Brier > 0.15', () => {
    const verdict = evaluateReleaseGate({
      byStyle: [
        { style: 'stable', brier: 0.2, recallTop15: 0.9, predictions: 100 },
        { style: 'rotating', brier: 0.3, recallTop15: 0.6, predictions: 50 },
      ],
      calibrationCurve: calibrationCurve([0.0]),
    });
    assert.equal(verdict.passes, false);
    assert.equal(
      verdict.reasons.some((r) => r.metric === 'stable_brier'),
      true,
    );
    const breach = verdict.reasons.find((r) => r.metric === 'stable_brier')!;
    assert.equal(breach.value, 0.2);
    assert.equal(breach.threshold, RELEASE_GATE_THRESHOLDS.stableBrierMax);
  });

  test('fails on rotating recall@15 < 0.55', () => {
    const verdict = evaluateReleaseGate({
      byStyle: [
        { style: 'stable', brier: 0.1, recallTop15: 0.9, predictions: 100 },
        { style: 'rotating', brier: 0.3, recallTop15: 0.4, predictions: 50 },
      ],
      calibrationCurve: calibrationCurve([0.0]),
    });
    assert.equal(verdict.passes, false);
    const breach = verdict.reasons.find((r) => r.metric === 'rotating_recall_top15');
    assert.ok(breach);
    assert.equal(breach!.value, 0.4);
  });

  test('fails on any calibration bin with |delta| > 0.20', () => {
    const verdict = evaluateReleaseGate({
      byStyle: [
        { style: 'stable', brier: 0.1, recallTop15: 0.9, predictions: 100 },
        { style: 'rotating', brier: 0.3, recallTop15: 0.6, predictions: 50 },
      ],
      calibrationCurve: calibrationCurve([0.0, 0.25, -0.1]),
    });
    assert.equal(verdict.passes, false);
    const breach = verdict.reasons.find((r) => r.metric === 'calibration_delta');
    assert.ok(breach);
    assert.equal(breach!.value, 0.25);
  });

  test('rotating bucket missing → gate fails (conservative default)', () => {
    const verdict = evaluateReleaseGate({
      byStyle: [
        { style: 'stable', brier: 0.05, recallTop15: 0.95, predictions: 200 },
      ],
      calibrationCurve: calibrationCurve([0.0]),
    });
    assert.equal(verdict.passes, false);
    assert.equal(verdict.rotatingEvaluable, false);
    assert.equal(
      verdict.reasons.some((r) => r.metric === 'rotating_recall_top15'),
      true,
    );
  });

  test('zero-prediction bins do not count against the gate', () => {
    const verdict = evaluateReleaseGate({
      byStyle: [
        { style: 'stable', brier: 0.05, recallTop15: 0.95, predictions: 200 },
        { style: 'rotating', brier: 0.3, recallTop15: 0.6, predictions: 50 },
      ],
      calibrationCurve: [
        {
          lower: 0,
          upper: 0.1,
          predictions: 0,
          meanProbability: 0.05,
          empiricalRate: 0.5,
          delta: 0.45,
        },
        ...calibrationCurve([0.0]),
      ],
    });
    assert.equal(verdict.passes, true);
  });

  test('multiple breaches all flagged', () => {
    const verdict = evaluateReleaseGate({
      byStyle: [
        { style: 'stable', brier: 0.25, recallTop15: 0.95, predictions: 200 },
        { style: 'rotating', brier: 0.4, recallTop15: 0.3, predictions: 50 },
      ],
      calibrationCurve: calibrationCurve([0.0, 0.5, -0.4]),
    });
    assert.equal(verdict.passes, false);
    const metrics = new Set(verdict.reasons.map((r) => r.metric));
    assert.ok(metrics.has('stable_brier'));
    assert.ok(metrics.has('rotating_recall_top15'));
    assert.ok(metrics.has('calibration_delta'));
  });
});
