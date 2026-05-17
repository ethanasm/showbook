#!/usr/bin/env node
// One-off seed for the Phase-6 setlist-intelligence screenshots. Creates:
//
//   - Beyoncé (theatrical-classified) + 12 corpus rows mirroring the
//     Cowboy Carter worked-example shape (9 acts, Act V surprise slot,
//     Act VII family-appearance rotation)
//   - King Gizzard (improvised-classified) + 10 corpus rows alternating
//     Regular / Marathon set lengths (the bimodal distribution that
//     drives the show-mode clusterer)
//   - One ticketed concert show per performer for the screenshot run's
//     worker user (e2e-w0@showbook.dev), so navigating to the show
//     detail page lands on the matching display variant.
//
// Usage:
//   DATABASE_URL=postgresql://showbook:showbook_dev@localhost:5433/showbook_e2e \
//     node scripts/seed-phase6-screenshot-data.mjs
//
// Idempotent: deletes prior fixture rows (keyed by the screenshot-phase6
// performer id sentinel) before inserting.

import postgres from 'postgres';

const WORKER_EMAIL = 'e2e-w0@showbook.dev';
const VENUE_ID = '00000000-0000-4000-8000-bbbbbb000001';

const BEYONCE_ID = '00000000-0000-4000-8000-bbbbbb000010';
const GIZZARD_ID = '00000000-0000-4000-8000-bbbbbb000011';

const BEYONCE_SHOW_ID = '00000000-0000-4000-8000-bbbbbb000020';
const GIZZARD_SHOW_ID = '00000000-0000-4000-8000-bbbbbb000021';

// Tour-setlist row id helper — combines a 4-char per-performer
// discriminator with the row index padded to 8 hex chars, then
// concats onto the shared 24-char UUID prefix so the resulting id
// is a valid 36-char UUID and unique per (performer, index).
function tourSetlistId(disc, i) {
  const idx = i.toString(16).padStart(8, '0');
  return `00000000-0000-4000-8000-${disc}${idx}`;
}

const url = process.env.DATABASE_URL ?? process.env.E2E_DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required.');
  process.exit(2);
}

const sql = postgres(url, { max: 2 });

const BEYONCE_ROTATIONS_ACT_V = [
  'DAUGHTER',
  'DAUGHTER',
  'DAUGHTER',
  'DAUGHTER',
  'FLAMENCO',
  'FLAMENCO',
  'FLAMENCO',
  'SMOKE HOUR var.',
  'SMOKE HOUR var.',
  'Crazy In Love (acoustic)',
  'Crazy In Love (acoustic)',
  'II HANDS II HEAVEN',
];
const BEYONCE_ROTATIONS_ACT_VII = [
  'PROTECTOR (with Rumi)',
  'PROTECTOR (with Rumi)',
  'PROTECTOR (with Rumi)',
  'PROTECTOR (with Rumi)',
  'PROTECTOR (with Rumi)',
  'PROTECTOR (with Rumi)',
  'BLACKBIIRD (with Blue Ivy)',
  'BLACKBIIRD (with Blue Ivy)',
  'BLACKBIIRD (with Blue Ivy)',
  'no family member tonight',
  'no family member tonight',
  'no family member tonight',
];

function beyonceSetlist(i) {
  return {
    sections: [
      { kind: 'set', name: 'Act I', songs: [
        { title: 'AMERICAN REQUIEM' },
        { title: 'Blackbird' },
        { title: 'The Star-Spangled Banner' },
      ] },
      { kind: 'set', name: 'Act II', songs: [
        { title: 'AMERICA HAS A PROBLEM' },
        { title: 'SPAGHETTII' },
        { title: 'Formation' },
        { title: 'Diva' },
      ] },
      { kind: 'set', name: 'Act III', songs: [
        { title: 'ALLIGATOR TEARS' },
        { title: 'JUST FOR FUN' },
        { title: 'PROTECTOR' },
      ] },
      { kind: 'set', name: 'Act IV', songs: [
        { title: 'BODYGUARD' },
        { title: 'JOLENE' },
      ] },
      { kind: 'set', name: 'Act V', songs: [
        { title: 'YA YA' },
        { title: BEYONCE_ROTATIONS_ACT_V[i] },
      ] },
      { kind: 'set', name: 'Act VI', songs: [
        { title: 'TYRANT' },
        { title: 'CUFF IT' },
      ] },
      { kind: 'set', name: 'Act VII', songs: [
        { title: BEYONCE_ROTATIONS_ACT_VII[i] },
      ] },
      { kind: 'set', name: 'Act VIII', songs: [
        { title: '16 CARRIAGES' },
      ] },
      { kind: 'encore', name: 'Encore', songs: [
        { title: 'AMEN' },
      ] },
    ],
  };
}

function gizzardSetlist(i) {
  // Alternate Regular (11 songs) and Marathon (26 songs) shows with
  // mostly-unique titles so uniqueRatio stays high (drives improvised
  // classification).
  const target = i % 2 === 0 ? 11 : 26;
  const songs = [];
  for (let j = 0; j < target; j += 1) {
    if (j === 0) songs.push('Gila Monster');
    else if (j === 1 && i % 3 === 0) songs.push('Robot Stop');
    else if (j === 2 && i % 4 === 0) songs.push('Rattlesnake');
    else songs.push(`Track ${i}-${j}`);
  }
  return {
    sections: [
      { kind: 'set', songs: songs.map((title) => ({ title })) },
    ],
  };
}

async function main() {
  console.log('Cleaning prior fixture rows…');
  await sql`DELETE FROM show_performers WHERE show_id IN (${BEYONCE_SHOW_ID}, ${GIZZARD_SHOW_ID})`;
  await sql`DELETE FROM shows WHERE id IN (${BEYONCE_SHOW_ID}, ${GIZZARD_SHOW_ID})`;
  await sql`DELETE FROM tour_setlists WHERE performer_id IN (${BEYONCE_ID}, ${GIZZARD_ID})`;
  await sql`DELETE FROM performers WHERE id IN (${BEYONCE_ID}, ${GIZZARD_ID})`;
  await sql`DELETE FROM venues WHERE id = ${VENUE_ID}`;

  const [user] = await sql`SELECT id FROM users WHERE email = ${WORKER_EMAIL} LIMIT 1`;
  if (!user) {
    console.error(`User ${WORKER_EMAIL} not found. Run /api/test/seed first.`);
    process.exit(3);
  }
  console.log(`Seeding for user ${user.id}.`);

  await sql`
    INSERT INTO venues (id, name, city, state_region, country, latitude, longitude)
    VALUES (${VENUE_ID}, 'Sphere at the Venetian Resort', 'Las Vegas', 'NV', 'US', 36.1213, -115.1700)
    ON CONFLICT (id) DO NOTHING
  `;

  // ─── Beyoncé (theatrical) ──────────────────────────────────────────
  await sql`
    INSERT INTO performers (id, name, musicbrainz_id, setlist_style)
    VALUES (${BEYONCE_ID}, 'Beyoncé', '859d0860-d480-4efd-970c-c05d5f1776b8', 'theatrical')
    ON CONFLICT (id) DO UPDATE SET setlist_style = EXCLUDED.setlist_style
  `;
  for (let i = 0; i < BEYONCE_ROTATIONS_ACT_V.length; i += 1) {
    const id = tourSetlistId('bee1', i);
    // Dates must fall within the 365-day window of the target show
    // date (2026-08-15) for `loadCorpusForPrediction` to pick them up.
    // 12 nights from 2026-05-01 through 2026-05-12.
    const day = String(1 + i).padStart(2, '0');
    const date = `2026-05-${day}`;
    await sql`
      INSERT INTO tour_setlists
        (id, performer_id, tour_id, tour_name, performance_date, setlistfm_id, setlist, song_count)
      VALUES (
        ${id}, ${BEYONCE_ID}, 'beyonce__cowboy-carter-tour', 'Cowboy Carter Tour',
        ${date}, ${'phase6-beyonce-' + i},
        ${sql.json(beyonceSetlist(i))}, 18
      )
      ON CONFLICT (id) DO NOTHING
    `;
  }
  await sql`
    INSERT INTO shows
      (id, user_id, kind, state, date, venue_id, ticket_count, tour_name, setlists)
    VALUES (
      ${BEYONCE_SHOW_ID}, ${user.id}, 'concert', 'ticketed',
      '2026-08-15', ${VENUE_ID}, 1, 'Cowboy Carter Tour', ${sql.json({})}
    )
    ON CONFLICT (id) DO NOTHING
  `;
  await sql`
    INSERT INTO show_performers (show_id, performer_id, role, sort_order)
    VALUES (${BEYONCE_SHOW_ID}, ${BEYONCE_ID}, 'headliner', 0)
    ON CONFLICT DO NOTHING
  `;

  // ─── King Gizzard (improvised) ─────────────────────────────────────
  await sql`
    INSERT INTO performers (id, name, musicbrainz_id, setlist_style)
    VALUES (${GIZZARD_ID}, 'King Gizzard & The Lizard Wizard', '83b9cbe7-9857-49e2-ab8e-b57b01038103', 'improvised')
    ON CONFLICT (id) DO UPDATE SET setlist_style = EXCLUDED.setlist_style
  `;
  for (let i = 0; i < 10; i += 1) {
    const id = tourSetlistId('912d', i);
    // 10 nights from 2026-04-01 stepping +3 days, all inside the 365-
    // day Tier-E window relative to the target show (2026-09-15).
    const day = String(1 + i * 3).padStart(2, '0');
    const date = `2026-04-${day}`;
    const setlist = gizzardSetlist(i);
    await sql`
      INSERT INTO tour_setlists
        (id, performer_id, tour_id, tour_name, performance_date, setlistfm_id, setlist, song_count)
      VALUES (
        ${id}, ${GIZZARD_ID}, NULL, NULL,
        ${date}, ${'phase6-gizzard-' + i},
        ${sql.json(setlist)}, ${setlist.sections[0].songs.length}
      )
      ON CONFLICT (id) DO NOTHING
    `;
  }
  await sql`
    INSERT INTO shows
      (id, user_id, kind, state, date, venue_id, ticket_count, setlists)
    VALUES (
      ${GIZZARD_SHOW_ID}, ${user.id}, 'concert', 'ticketed',
      '2026-09-15', ${VENUE_ID}, 1, ${sql.json({})}
    )
    ON CONFLICT (id) DO NOTHING
  `;
  await sql`
    INSERT INTO show_performers (show_id, performer_id, role, sort_order)
    VALUES (${GIZZARD_SHOW_ID}, ${GIZZARD_ID}, 'headliner', 0)
    ON CONFLICT DO NOTHING
  `;

  console.log(`Done. Beyoncé show: ${BEYONCE_SHOW_ID}; King Gizzard show: ${GIZZARD_SHOW_ID}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => sql.end());
