import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeShowName,
  showMatchesAnnouncement,
  type ShowForDedup,
  type AnnouncementForDedup,
} from '../utils/show-dedup';

function show(partial: Partial<ShowForDedup>): ShowForDedup {
  return {
    date: null,
    endDate: null,
    productionName: null,
    headlinerName: null,
    ...partial,
  };
}

function announcement(
  partial: Partial<AnnouncementForDedup> & { showDate: string; headliner: string },
): AnnouncementForDedup {
  return {
    productionName: null,
    runStartDate: null,
    runEndDate: null,
    performanceDates: null,
    ...partial,
  };
}

test('normalizeShowName lowercases, strips punctuation, and drops leading articles', () => {
  assert.equal(normalizeShowName('The Killers'), 'killers');
  assert.equal(normalizeShowName('Taylor Swift: The Eras Tour'), 'taylor swift the eras tour');
  assert.equal(normalizeShowName('  BottleRock!! '), 'bottlerock');
  assert.equal(normalizeShowName(null), '');
  assert.equal(normalizeShowName(undefined), '');
});

test('showMatchesAnnouncement collapses a poster-uploaded festival against the TM announcement', () => {
  // The exact case from the user's bug report.
  const userShow = show({
    date: '2026-05-22',
    productionName: 'Bottlerock',
  });
  const tmAnnouncement = announcement({
    showDate: '2026-05-22',
    productionName: 'BottleRock Napa Valley',
    headliner: 'Various Artists',
  });
  assert.equal(showMatchesAnnouncement(userShow, tmAnnouncement), true);
});

test('showMatchesAnnouncement matches a tour-name announcement against a bare headliner show', () => {
  const userShow = show({
    date: '2026-08-10',
    headlinerName: 'Taylor Swift',
  });
  const tmAnnouncement = announcement({
    showDate: '2026-08-10',
    productionName: 'Taylor Swift: The Eras Tour',
    headliner: 'Taylor Swift',
  });
  assert.equal(showMatchesAnnouncement(userShow, tmAnnouncement), true);
});

test('showMatchesAnnouncement strips a leading "the" before comparing', () => {
  const userShow = show({ date: '2026-09-01', headlinerName: 'The Killers' });
  const tmAnnouncement = announcement({
    showDate: '2026-09-01',
    headliner: 'Killers',
  });
  assert.equal(showMatchesAnnouncement(userShow, tmAnnouncement), true);
});

test('showMatchesAnnouncement does not collapse different artists on the same night', () => {
  const userShow = show({ date: '2026-06-01', headlinerName: 'Coldplay' });
  const tmAnnouncement = announcement({
    showDate: '2026-06-01',
    headliner: 'Pearl Jam',
  });
  assert.equal(showMatchesAnnouncement(userShow, tmAnnouncement), false);
});

test('showMatchesAnnouncement is token-aware so short prefixes do not bleed across words', () => {
  // "rage" prefixes "rage against the machine" (token boundary) — match.
  assert.equal(
    showMatchesAnnouncement(
      show({ date: '2026-07-01', headlinerName: 'Rage' }),
      announcement({ showDate: '2026-07-01', headliner: 'Rage Against The Machine' }),
    ),
    true,
  );
  // "rage" against "Rageful" — no token boundary, should NOT match even though
  // the date and venue are the same.
  assert.equal(
    showMatchesAnnouncement(
      show({ date: '2026-07-01', headlinerName: 'Rage' }),
      announcement({ showDate: '2026-07-01', headliner: 'Rageful' }),
    ),
    false,
  );
});

test('showMatchesAnnouncement requires date overlap', () => {
  const userShow = show({ date: '2026-05-22', productionName: 'Bottlerock' });
  const tmAnnouncement = announcement({
    showDate: '2026-06-22',
    productionName: 'BottleRock Napa Valley',
    headliner: 'Various Artists',
  });
  assert.equal(showMatchesAnnouncement(userShow, tmAnnouncement), false);
});

test('showMatchesAnnouncement considers a multi-night festival run', () => {
  // User logged the festival as one entry spanning May 22 → May 24. Each daily
  // TM announcement within that range should dedupe against it.
  const userShow = show({
    date: '2026-05-22',
    endDate: '2026-05-24',
    productionName: 'Bottlerock',
  });
  for (const d of ['2026-05-22', '2026-05-23', '2026-05-24']) {
    assert.equal(
      showMatchesAnnouncement(
        userShow,
        announcement({
          showDate: d,
          productionName: 'BottleRock Napa Valley',
          headliner: 'Various Artists',
        }),
      ),
      true,
      `expected match for ${d}`,
    );
  }
  // A day outside the run still surfaces.
  assert.equal(
    showMatchesAnnouncement(
      userShow,
      announcement({
        showDate: '2026-05-25',
        productionName: 'BottleRock Napa Valley',
        headliner: 'Various Artists',
      }),
    ),
    false,
  );
});

test('showMatchesAnnouncement falls back through performanceDates for multi-night TM runs', () => {
  const userShow = show({ date: '2026-10-04', productionName: 'Hamilton' });
  const tmAnnouncement = announcement({
    showDate: '2026-10-01',
    runStartDate: null,
    runEndDate: null,
    performanceDates: ['2026-10-01', '2026-10-04', '2026-10-07'],
    productionName: 'Hamilton',
    headliner: 'Hamilton Touring Co.',
  });
  assert.equal(showMatchesAnnouncement(userShow, tmAnnouncement), true);
});

test('showMatchesAnnouncement returns false when the user show has no date', () => {
  // state='watching' with no committed date — nothing to match against yet.
  const userShow = show({ date: null, productionName: 'Bottlerock' });
  const tmAnnouncement = announcement({
    showDate: '2026-05-22',
    productionName: 'BottleRock Napa Valley',
    headliner: 'Various Artists',
  });
  assert.equal(showMatchesAnnouncement(userShow, tmAnnouncement), false);
});
