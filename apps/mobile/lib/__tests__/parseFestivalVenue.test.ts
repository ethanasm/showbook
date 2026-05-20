import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseFestivalVenue } from '../festival-lineup/parseFestivalVenue';
import type { FestivalLineupMeta } from '../festival-lineup/useFestivalLineup';

function meta(partial: Partial<FestivalLineupMeta>): FestivalLineupMeta {
  return {
    festivalName: null,
    startDate: null,
    endDate: null,
    venueHint: null,
    ...partial,
  };
}

describe('parseFestivalVenue', () => {
  it('splits "Name, City" hints into venue name + city', () => {
    assert.deepEqual(
      parseFestivalVenue(meta({ venueHint: 'Citi Field, NYC' })),
      { name: 'Citi Field', city: 'NYC' },
    );
  });

  it('preserves commas inside the city when there are extra splits', () => {
    assert.deepEqual(
      parseFestivalVenue(meta({ venueHint: 'Wrigley Field, Chicago, IL' })),
      { name: 'Wrigley Field', city: 'Chicago, IL' },
    );
  });

  it('treats a lone location as the city and uses the festival name as the venue', () => {
    assert.deepEqual(
      parseFestivalVenue(
        meta({ venueHint: 'Napa Valley', festivalName: 'Bottlerock' }),
      ),
      { name: 'Bottlerock', city: 'Napa Valley' },
    );
  });

  it('falls back to the hint as venue name when there is no festival name', () => {
    assert.deepEqual(
      parseFestivalVenue(meta({ venueHint: 'Napa Valley' })),
      { name: 'Napa Valley', city: 'Napa Valley' },
    );
  });

  it('uses the festival name + "TBA" city when no hint was extracted', () => {
    assert.deepEqual(
      parseFestivalVenue(meta({ festivalName: 'Bottlerock' })),
      { name: 'Bottlerock', city: 'TBA' },
    );
  });

  it('falls back to "TBA" / "TBA" when extractor returned nothing', () => {
    assert.deepEqual(parseFestivalVenue(meta({})), {
      name: 'TBA',
      city: 'TBA',
    });
  });

  it('never persists the literal string "Unknown" the old code wrote', () => {
    for (const hint of [null, '', 'Napa Valley', 'Citi Field, NYC']) {
      const result = parseFestivalVenue(
        meta({ venueHint: hint, festivalName: 'Bottlerock' }),
      );
      assert.notEqual(result.city, 'Unknown');
      assert.notEqual(result.name, 'Unknown');
    }
  });
});
