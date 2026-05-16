/**
 * Unit suite for the corpus-fill job. Hits the pure helpers
 * (`synthesizeTourId`) directly with an injected DB lookup so the
 * year-salt logic + 365-day window can be exercised without standing
 * up postgres. End-to-end behaviour against a real DB lives in the
 * integration test.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { synthesizeTourId } from '../setlist-corpus-fill';

const PERFORMER = '11111111-1111-4111-8111-111111111111';

describe('synthesizeTourId — year salt + 365d window', () => {
  test('a brand-new tour name uses the new setlist year as the run salt', async () => {
    const id = await synthesizeTourId({
      performerId: PERFORMER,
      tourName: 'Short n\' Sweet Tour',
      performanceDate: '2024-09-01',
      lookupExistingMin: async () => null,
    });
    assert.match(id, /^tour_[a-f0-9]{16}$/);
  });

  test('same tour name in a different year (after >365d gap) gets a fresh salt', async () => {
    const idA = await synthesizeTourId({
      performerId: PERFORMER,
      tourName: 'World Tour',
      performanceDate: '2018-06-01',
      lookupExistingMin: async () => null,
    });
    const idB = await synthesizeTourId({
      performerId: PERFORMER,
      tourName: 'World Tour',
      performanceDate: '2022-06-01',
      lookupExistingMin: async () => null, // 4 years apart → no existing run
    });
    assert.notEqual(idA, idB, 'reused name 4 years later must get a fresh salt');
  });

  test('same tour name within 365d collapses to the existing run', async () => {
    // First setlist of Short n' Sweet ran in 2024-09-01.
    const firstId = await synthesizeTourId({
      performerId: PERFORMER,
      tourName: 'Short n\' Sweet Tour',
      performanceDate: '2024-09-01',
      lookupExistingMin: async () => null,
    });
    // Eight months later, same tour name — should reuse salt.
    const laterId = await synthesizeTourId({
      performerId: PERFORMER,
      tourName: 'Short n\' Sweet Tour',
      performanceDate: '2025-05-01',
      lookupExistingMin: async () => '2024-09-01',
    });
    assert.equal(firstId, laterId);
  });

  test('case-insensitive on tour name', async () => {
    const upper = await synthesizeTourId({
      performerId: PERFORMER,
      tourName: 'COWBOY CARTER TOUR',
      performanceDate: '2025-05-01',
      lookupExistingMin: async () => null,
    });
    const lower = await synthesizeTourId({
      performerId: PERFORMER,
      tourName: 'cowboy carter tour',
      performanceDate: '2025-05-01',
      lookupExistingMin: async () => null,
    });
    assert.equal(upper, lower);
  });

  test('different performers with the same tour name get distinct ids', async () => {
    const PERFORMER_B = '22222222-2222-4222-8222-222222222222';
    const idA = await synthesizeTourId({
      performerId: PERFORMER,
      tourName: 'World Tour',
      performanceDate: '2025-05-01',
      lookupExistingMin: async () => null,
    });
    const idB = await synthesizeTourId({
      performerId: PERFORMER_B,
      tourName: 'World Tour',
      performanceDate: '2025-05-01',
      lookupExistingMin: async () => null,
    });
    assert.notEqual(idA, idB);
  });

  test('Sabrina Carpenter — single tour name across Dec 2022 → Mar 2023 stays one run', async () => {
    const dec22 = await synthesizeTourId({
      performerId: PERFORMER,
      tourName: 'Emails I Can\'t Send Tour',
      performanceDate: '2022-12-10',
      lookupExistingMin: async () => null,
    });
    const mar23 = await synthesizeTourId({
      performerId: PERFORMER,
      tourName: 'Emails I Can\'t Send Tour',
      performanceDate: '2023-03-10',
      // Within 365d — DB lookup returns the dec date.
      lookupExistingMin: async () => '2022-12-10',
    });
    assert.equal(dec22, mar23, 'tour spanning Dec→Mar (~90d) is one run');
  });

  test('Coldplay — Music of the Spheres 2022→2024 stays one run because each year-link is <365d', async () => {
    // First date: 2022-06.
    const y2022 = await synthesizeTourId({
      performerId: PERFORMER,
      tourName: 'Music of the Spheres World Tour',
      performanceDate: '2022-06-01',
      lookupExistingMin: async () => null,
    });
    // Eleven months later — within 365d, anchored to 2022-06.
    const y2023 = await synthesizeTourId({
      performerId: PERFORMER,
      tourName: 'Music of the Spheres World Tour',
      performanceDate: '2023-05-01',
      lookupExistingMin: async () => '2022-06-01',
    });
    // 2024 stop — within 365d of 2023 stop, still anchored to 2022.
    const y2024 = await synthesizeTourId({
      performerId: PERFORMER,
      tourName: 'Music of the Spheres World Tour',
      performanceDate: '2024-04-01',
      lookupExistingMin: async () => '2022-06-01',
    });
    assert.equal(y2022, y2023);
    assert.equal(y2023, y2024);
  });

  test('Phish — "Summer Tour 2025" + "Summer Tour 2026" split on name (different LOWER tour_name)', async () => {
    const tour25 = await synthesizeTourId({
      performerId: PERFORMER,
      tourName: 'Summer Tour 2025',
      performanceDate: '2025-07-01',
      lookupExistingMin: async () => null,
    });
    const tour26 = await synthesizeTourId({
      performerId: PERFORMER,
      tourName: 'Summer Tour 2026',
      performanceDate: '2026-07-01',
      lookupExistingMin: async () => null,
    });
    assert.notEqual(tour25, tour26);
  });

  test('throws when tourName is empty after trim', async () => {
    await assert.rejects(
      synthesizeTourId({
        performerId: PERFORMER,
        tourName: '   ',
        performanceDate: '2026-05-01',
        lookupExistingMin: async () => null,
      }),
      /tourName must be non-empty/,
    );
  });

  test('id is stable across repeated calls (same inputs → same hash)', async () => {
    const a = await synthesizeTourId({
      performerId: PERFORMER,
      tourName: 'Tour X',
      performanceDate: '2026-01-01',
      lookupExistingMin: async () => null,
    });
    const b = await synthesizeTourId({
      performerId: PERFORMER,
      tourName: 'Tour X',
      performanceDate: '2026-01-01',
      lookupExistingMin: async () => null,
    });
    assert.equal(a, b);
  });

  test('id is prefixed `tour_` for forwards-compat with display logic', async () => {
    const id = await synthesizeTourId({
      performerId: PERFORMER,
      tourName: 'Tour',
      performanceDate: '2026-05-01',
      lookupExistingMin: async () => null,
    });
    assert.match(id, /^tour_/);
  });

  test('boundary case — exactly 365 days back hits the existing run', async () => {
    const earlier = await synthesizeTourId({
      performerId: PERFORMER,
      tourName: 'Boundary Tour',
      performanceDate: '2025-01-01',
      lookupExistingMin: async () => null,
    });
    const later = await synthesizeTourId({
      performerId: PERFORMER,
      tourName: 'Boundary Tour',
      performanceDate: '2026-01-01',
      // 365 days exactly — within window, lookup returns earlier min.
      lookupExistingMin: async () => '2025-01-01',
    });
    assert.equal(earlier, later);
  });

  test('boundary case — beyond 365 days starts a fresh run', async () => {
    // Note: at the boundary the DB lookup is what enforces the cutoff.
    // We simulate that by returning null when the gap exceeds 365 days.
    const earlier = await synthesizeTourId({
      performerId: PERFORMER,
      tourName: 'Gap Tour',
      performanceDate: '2024-01-01',
      lookupExistingMin: async () => null,
    });
    const later = await synthesizeTourId({
      performerId: PERFORMER,
      tourName: 'Gap Tour',
      performanceDate: '2026-06-01',
      lookupExistingMin: async () => null, // No row within ±365d.
    });
    assert.notEqual(earlier, later);
  });
});
