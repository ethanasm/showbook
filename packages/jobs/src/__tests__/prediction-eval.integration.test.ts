/**
 * Integration suite for the Phase 4 daily back-test eval harness. Seeds
 * a synthetic 14-day Tate McRae corpus (carryover from the Phase 1
 * integration fixture), runs the back-test, and asserts the persisted
 * `prediction_eval_runs` + `prediction_eval_shows` rows.
 *
 * Requires DATABASE_URL pointing at the e2e postgres. Skips automatically
 * when DATABASE_URL is unset.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { eq, sql } from 'drizzle-orm';
import {
  db,
  performers,
  predictionEvalRuns,
  predictionEvalShows,
  tourSetlists,
} from '@showbook/db';
import { synthesizeTourId } from '../setlist-corpus-fill';
import { runDailyBacktest } from '../prediction-eval';

const PREFIX = '20260516';
const PERFORMER = `${PREFIX}-3333-4333-8333-333333333333`;
const TOUR_NAME = 'Phase-4 Eval Tour';

const TODAY = '2025-09-30';
const CORE = [
  'Miss possessive',
  "No I'm not in love",
  '2 hands',
  'guilty conscience',
  'Purple lace bra',
  'Like I do',
  'uh oh',
  'Dear god',
  'Siren sounds',
  'Greenlight',
  'Nostalgia (flashback medley)',
  'you broke me first',
  'run for the hills',
  'exes',
  'bloodonmyhands',
  "she's all i wanna be",
  'Revolving door',
  "It's ok I'm ok",
];
const ENCORE = ['Just Keep Watching', 'Sports car', 'greedy'];

async function cleanup(): Promise<void> {
  await db.execute(
    sql`DELETE FROM prediction_eval_shows WHERE performer_id::text LIKE ${PREFIX + '-%'}`,
  );
  // No clean way to scope eval-runs to a performer (we record aggregates);
  // the test isolates by inspecting the runId returned from the harness.
  await db.execute(sql`DELETE FROM tour_setlists WHERE performer_id::text LIKE ${PREFIX + '-%'}`);
  await db.execute(sql`DELETE FROM performers WHERE id::text LIKE ${PREFIX + '-%'}`);
}

describe('prediction-eval daily back-test integration', () => {
  before(async () => {
    if (!process.env.DATABASE_URL) {
      console.log('[prediction-eval integration] DATABASE_URL not set — skipping');
      return;
    }
    await cleanup();
    await db.insert(performers).values({
      id: PERFORMER,
      name: 'Eval Fixture Performer',
      musicbrainzId: `${PREFIX}-fakembid-eval`,
    });
    // Seed 14 setlists at 2025-09-17 .. 2025-09-30 (inclusive); the back-test
    // walks every (performer, date) in the trailing 14 days from TODAY and
    // re-predicts against the corpus truncated to before that date.
    for (let i = 0; i < 14; i++) {
      const day = String(17 + i).padStart(2, '0');
      const date = `2025-09-${day}`;
      const tourId = await synthesizeTourId({
        performerId: PERFORMER,
        tourName: TOUR_NAME,
        performanceDate: date,
      });
      await db.insert(tourSetlists).values({
        id: `${PREFIX}-cccc-4ccc-8ccc-${String(i).padStart(12, '0')}`,
        performerId: PERFORMER,
        tourId,
        tourName: TOUR_NAME,
        performanceDate: date,
        setlistfmId: `setlistfm-eval-${i}`,
        setlist: {
          sections: [
            { kind: 'set', songs: CORE.map((title) => ({ title })) },
            { kind: 'encore', songs: ENCORE.map((title) => ({ title })) },
          ],
        },
        songCount: CORE.length + ENCORE.length,
      });
    }
  });

  after(async () => {
    if (!process.env.DATABASE_URL) return;
    await cleanup();
  });

  it('writes a run row and per-show rows', { skip: !process.env.DATABASE_URL }, async () => {
    const result = await runDailyBacktest({ windowDays: 14, today: TODAY });
    assert.ok(result.runId, 'expected the harness to write a run row');
    assert.ok(result.evaluatedShows >= 10, `expected ≥10 evaluations, got ${result.evaluatedShows}`);

    const [runRow] = await db
      .select()
      .from(predictionEvalRuns)
      .where(eq(predictionEvalRuns.id, result.runId!));
    assert.ok(runRow, 'run row missing');
    assert.equal(runRow!.windowDays, 14);

    const showRows = await db
      .select()
      .from(predictionEvalShows)
      .where(eq(predictionEvalShows.runId, result.runId!));
    assert.equal(showRows.length, result.evaluatedShows);
  });

  it('a stable 21-song corpus achieves Brier ≤ 0.05', { skip: !process.env.DATABASE_URL }, async () => {
    const result = await runDailyBacktest({ windowDays: 14, today: TODAY });
    assert.ok(
      result.brierScore <= 0.05,
      `expected Brier ≤ 0.05 on the stable corpus, got ${result.brierScore}`,
    );
    assert.ok(
      result.precisionTop10 >= 0.85,
      `expected P@10 ≥ 0.85 on the stable corpus, got ${result.precisionTop10}`,
    );
  });

  it('persists calibration curve as a 10-bin array', { skip: !process.env.DATABASE_URL }, async () => {
    const result = await runDailyBacktest({ windowDays: 14, today: TODAY });
    const [row] = await db
      .select({ curve: predictionEvalRuns.calibrationCurve })
      .from(predictionEvalRuns)
      .where(eq(predictionEvalRuns.id, result.runId!));
    assert.ok(Array.isArray(row?.curve));
    assert.equal((row!.curve as unknown[]).length, 10);
  });

  it('records non-empty per-style aggregate for `stable`', { skip: !process.env.DATABASE_URL }, async () => {
    const result = await runDailyBacktest({ windowDays: 14, today: TODAY });
    const stable = result.byStyle.find((s) => s.style === 'stable');
    assert.ok(stable, 'expected a stable-style entry');
    assert.ok(stable!.predictions > 0);
  });
});
