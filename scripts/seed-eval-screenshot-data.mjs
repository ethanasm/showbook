#!/usr/bin/env node
// One-off seed for the /admin/eval screenshot. Populates two recent
// prediction_eval_runs rows and a handful of prediction_eval_shows rows
// against a fake performer, then promotes the supplied email to admin
// (via `ADMIN_EMAILS` — actually injected through the dev server env,
// this script just ensures the user row exists).
//
// Usage:
//   DATABASE_URL=postgresql://...  node scripts/seed-eval-screenshot-data.mjs
//
// Idempotent: deletes prior rows with the prefix `screenshot-` before inserting.

import postgres from 'postgres';

const PREFIX = 'screenshot-eval';
const PERFORMER_ID = '00000000-0000-4000-8000-eeeeeeeeeeee';
const TOUR_SETLIST_ID_PREFIX = '00000000-0000-4000-8000-aaaaaaaaaaaa';

const url = process.env.DATABASE_URL ?? process.env.E2E_DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required.');
  process.exit(2);
}

const sql = postgres(url, { max: 2 });

async function main() {
  // Wipe any prior fake rows. The FK from prediction_eval_shows.run_id to
  // prediction_eval_runs cascades, so deleting the runs cleans both.
  await sql`DELETE FROM prediction_eval_runs WHERE id::text LIKE '00000000-0000-4000-8000-%'`;
  await sql`DELETE FROM tour_setlists WHERE performer_id = ${PERFORMER_ID}`;
  await sql`DELETE FROM performers WHERE id = ${PERFORMER_ID}`;

  await sql`
    INSERT INTO performers (id, name, musicbrainz_id)
    VALUES (${PERFORMER_ID}, 'Backtest Fixture (Tate-style)', 'mbid-fixture')
    ON CONFLICT (id) DO NOTHING
  `;

  // Synthesize a corpus of 14 tour-setlist rows so the "Re-run for show"
  // button has something to fire against. Each row has a 21-song core set
  // + 3-song encore, mirroring the integration test fixture.
  const core = [
    'Miss possessive', "No I'm not in love", '2 hands', 'guilty conscience',
    'Purple lace bra', 'Like I do', 'uh oh', 'Dear god', 'Siren sounds',
    'Greenlight', 'Nostalgia (flashback medley)', 'you broke me first',
    'run for the hills', 'exes', 'bloodonmyhands', "she's all i wanna be",
    'Revolving door', "It's ok I'm ok",
  ];
  const encore = ['Just Keep Watching', 'Sports car', 'greedy'];
  for (let i = 0; i < 14; i++) {
    const day = String(17 + i).padStart(2, '0');
    const date = `2025-09-${day}`;
    const id = `${TOUR_SETLIST_ID_PREFIX.slice(0, -12)}${String(i).padStart(12, '0')}`;
    await sql`
      INSERT INTO tour_setlists
        (id, performer_id, tour_id, tour_name, performance_date, setlistfm_id, setlist, song_count)
      VALUES (
        ${id}, ${PERFORMER_ID}, ${'tour_eval_fixture'}, ${'Eval Fixture Tour'},
        ${date}, ${'setlistfm-eval-screenshot-' + i},
        ${sql.json({
          sections: [
            { kind: 'set', songs: core.map((title) => ({ title })) },
            { kind: 'encore', songs: encore.map((title) => ({ title })) },
          ],
        })},
        ${core.length + encore.length}
      )
      ON CONFLICT (id) DO NOTHING
    `;
  }

  // Calibration curve — 10 bins, with predictions clustered around 0.85
  // and 0.05 (mirroring a well-calibrated stable artist).
  const curve = Array.from({ length: 10 }, (_, i) => {
    const lower = i / 10;
    const upper = (i + 1) / 10;
    // Plant most mass in the [0.8, 0.9] and [0.9, 1.0] bins (core songs)
    // and the [0.0, 0.1] bin (rotation pile).
    let predictions = 4;
    if (i === 0) predictions = 280;
    else if (i === 1) predictions = 18;
    else if (i === 8) predictions = 132;
    else if (i === 9) predictions = 290;
    const meanProbability =
      i === 0 ? 0.04 : i === 9 ? 0.95 : (lower + upper) / 2;
    const empiricalRate =
      i === 0 ? 0.02 : i === 9 ? 0.96 : meanProbability + 0.02;
    return {
      lower,
      upper,
      predictions,
      meanProbability,
      empiricalRate,
      delta: empiricalRate - meanProbability,
    };
  });

  // Two recent runs so the trailing-30 chart has more than one point.
  const runs = [
    {
      id: '00000000-0000-4000-8000-100000000001',
      ranAt: new Date(Date.now() - 24 * 3600 * 1000),
      brier: 0.041,
      precisionTop10: 0.93,
      recallTop10: 0.74,
      recallTop15: 0.88,
      predictions: 754,
    },
    {
      id: '00000000-0000-4000-8000-100000000002',
      ranAt: new Date(Date.now() - 7 * 24 * 3600 * 1000),
      brier: 0.058,
      precisionTop10: 0.88,
      recallTop10: 0.70,
      recallTop15: 0.83,
      predictions: 712,
    },
    {
      id: '00000000-0000-4000-8000-100000000003',
      ranAt: new Date(Date.now() - 14 * 24 * 3600 * 1000),
      brier: 0.072,
      precisionTop10: 0.85,
      recallTop10: 0.66,
      recallTop15: 0.78,
      predictions: 690,
    },
    {
      id: '00000000-0000-4000-8000-100000000004',
      ranAt: new Date(Date.now() - 21 * 24 * 3600 * 1000),
      brier: 0.064,
      precisionTop10: 0.86,
      recallTop10: 0.69,
      recallTop15: 0.80,
      predictions: 705,
    },
  ];
  for (const run of runs) {
    await sql`
      INSERT INTO prediction_eval_runs
        (id, ran_at, predictions, brier_score, calibration_curve,
         precision_top10, recall_top10, recall_top15, window_days, by_style)
      VALUES (
        ${run.id}, ${run.ranAt}, ${run.predictions}, ${run.brier},
        ${sql.json(curve)},
        ${run.precisionTop10}, ${run.recallTop10}, ${run.recallTop15},
        ${14},
        ${sql.json([
          {
            style: 'stable',
            predictions: run.predictions,
            brier: run.brier,
            precisionTop10: run.precisionTop10,
            recallActual: run.recallTop15,
            recallTop15: run.recallTop15,
            calibrationError: 0.04,
          },
        ])}
      )
    `;
  }

  // Per-show rows for the latest run only.
  const latestRunId = runs[0].id;
  const predicted = [
    ...core.map((title, i) => ({ title, probability: 0.95 - i * 0.005, hit: true })),
    ...encore.map((title, i) => ({ title, probability: 0.88 - i * 0.01, hit: true })),
    { title: 'Wildcard A', probability: 0.18, hit: false },
    { title: 'Wildcard B', probability: 0.09, hit: false },
  ];
  const actual = [...core, ...encore];

  for (let i = 0; i < 8; i++) {
    const day = String(23 + i).padStart(2, '0');
    const date = `2025-09-${day}`;
    const tourSetlistId = `${TOUR_SETLIST_ID_PREFIX.slice(0, -12)}${String(i + 6).padStart(12, '0')}`;
    const brierAdj = 0.04 + (i % 3) * 0.01;
    await sql`
      INSERT INTO prediction_eval_shows
        (id, run_id, tour_setlist_id, performer_id, performer_name,
         performance_date, style, brier, precision_top10, recall_actual,
         recall_top15, sample_size, predicted, actual)
      VALUES (
        gen_random_uuid(), ${latestRunId}, ${tourSetlistId},
        ${PERFORMER_ID}, ${'Backtest Fixture (Tate-style)'},
        ${date}, ${'stable'},
        ${brierAdj}, ${0.95 - (i % 3) * 0.02}, ${0.92 - (i % 3) * 0.02},
        ${0.88 - (i % 3) * 0.02}, ${14},
        ${sql.json(predicted)}, ${sql.json(actual)}
      )
    `;
  }

  console.log('Eval screenshot data seeded.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => sql.end());
