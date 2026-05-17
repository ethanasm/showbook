/**
 * Integration suite for the Phase 5 calibration release-gate wired
 * through the public `setlistIntel.releaseGate` tRPC procedure. Seeds
 * `prediction_eval_runs` with a passing/failing payload, then queries
 * the procedure end-to-end and asserts the verdict.
 *
 * Requires DATABASE_URL pointing at the e2e postgres. Skips
 * automatically when DATABASE_URL is unset.
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from 'drizzle-orm';
import { db, predictionEvalRuns } from '@showbook/db';
import { setlistIntelRouter } from '../routers/setlist-intel';
import { createContext } from '../trpc';
import { withTimeout } from './_test-helpers';

const SUITE_TAG = 'release-gate-integration';

async function cleanup(): Promise<void> {
  // The setlistIntel.releaseGate procedure reads the *most recent* run,
  // so we wipe everything to guarantee the seeded row is current.
  await db.execute(sql`DELETE FROM prediction_eval_shows`);
  await db.execute(sql`DELETE FROM prediction_eval_runs`);
}

function publicCaller() {
  // releaseGate is publicProcedure — no session required.
  return setlistIntelRouter.createCaller(createContext({ session: null }));
}

describe('setlistIntel.releaseGate — integration', () => {
  before(async () => {
    if (!process.env.DATABASE_URL) {
      console.log(`[${SUITE_TAG}] DATABASE_URL not set — skipping`);
      return;
    }
    await withTimeout(45_000, () => cleanup());
  });

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) return;
    await withTimeout(45_000, () => cleanup());
  });

  after(async () => {
    if (!process.env.DATABASE_URL) return;
    await withTimeout(45_000, () => cleanup());
  });

  it('passes when seeded with a passing eval-run row', async (t) => {
    if (!process.env.DATABASE_URL) {
      t.skip('DATABASE_URL not set');
      return;
    }
    await db.insert(predictionEvalRuns).values({
      predictions: 200,
      brierScore: 0.12,
      precisionTop10: 0.7,
      recallTop10: 0.5,
      recallTop15: 0.6,
      windowDays: 14,
      byStyle: [
        { style: 'stable', brier: 0.1, precisionTop10: 0.7, recallActual: 0.6, recallTop15: 0.7, predictions: 150, calibrationError: 0.05 },
        { style: 'rotating', brier: 0.3, precisionTop10: 0.2, recallActual: 0.5, recallTop15: 0.6, predictions: 50, calibrationError: 0.1 },
      ],
      calibrationCurve: [
        { lower: 0, upper: 0.5, predictions: 100, meanProbability: 0.25, empiricalRate: 0.3, delta: 0.05 },
        { lower: 0.5, upper: 1, predictions: 100, meanProbability: 0.75, empiricalRate: 0.7, delta: -0.05 },
      ],
    });

    const result = await publicCaller().releaseGate();
    assert.equal(result.passes, true);
    assert.equal(result.reasons.length, 0);
    assert.equal(result.rotatingEvaluable, true);
    assert.ok(result.latestRunId);
  });

  it('fails when seeded with a failing eval-run row (rotating recall too low)', async (t) => {
    if (!process.env.DATABASE_URL) {
      t.skip('DATABASE_URL not set');
      return;
    }
    await db.insert(predictionEvalRuns).values({
      predictions: 200,
      brierScore: 0.12,
      precisionTop10: 0.7,
      recallTop10: 0.5,
      recallTop15: 0.4,
      windowDays: 14,
      byStyle: [
        { style: 'stable', brier: 0.1, precisionTop10: 0.7, recallActual: 0.6, recallTop15: 0.7, predictions: 150, calibrationError: 0.05 },
        { style: 'rotating', brier: 0.3, precisionTop10: 0.2, recallActual: 0.3, recallTop15: 0.3, predictions: 50, calibrationError: 0.1 },
      ],
      calibrationCurve: [
        { lower: 0, upper: 0.5, predictions: 100, meanProbability: 0.25, empiricalRate: 0.3, delta: 0.05 },
        { lower: 0.5, upper: 1, predictions: 100, meanProbability: 0.75, empiricalRate: 0.7, delta: -0.05 },
      ],
    });

    const result = await publicCaller().releaseGate();
    assert.equal(result.passes, false);
    assert.ok(result.reasons.length >= 1);
    const breach = result.reasons.find((r) => r.metric === 'rotating_recall_top15');
    assert.ok(breach, 'expected a rotating recall breach');
    assert.equal(breach!.value, 0.3);
  });

  it('fails with no eval-run rows on disk', async (t) => {
    if (!process.env.DATABASE_URL) {
      t.skip('DATABASE_URL not set');
      return;
    }
    // No insert — table is empty.
    const result = await publicCaller().releaseGate();
    assert.equal(result.passes, false);
    assert.equal(result.latestRunId, null);
  });
});
