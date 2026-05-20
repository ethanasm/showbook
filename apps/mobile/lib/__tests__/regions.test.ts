import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_REGIONS,
  DEFAULT_RADIUS_MILES,
  RADIUS_OPTIONS,
  canAddRegion,
  formatRegionSummary,
  parseRegionInput,
} from '../regions';

describe('MAX_REGIONS', () => {
  it('matches the server-side cap in preferences.addRegion', () => {
    // If this changes, update packages/api/src/routers/preferences.ts too.
    assert.equal(MAX_REGIONS, 5);
  });
});

describe('canAddRegion', () => {
  it('is true when the user has zero regions', () => {
    assert.equal(canAddRegion(0), true);
  });

  it('is true when the user has fewer than the cap', () => {
    assert.equal(canAddRegion(1), true);
    assert.equal(canAddRegion(4), true);
  });

  it('is false at the cap', () => {
    assert.equal(canAddRegion(MAX_REGIONS), false);
  });

  it('is false above the cap (defence-in-depth — server should refuse)', () => {
    assert.equal(canAddRegion(MAX_REGIONS + 1), false);
    assert.equal(canAddRegion(99), false);
  });

  it('treats NaN / negative counts as zero so the UI fails open', () => {
    assert.equal(canAddRegion(Number.NaN), true);
    assert.equal(canAddRegion(-1), true);
  });
});

describe('formatRegionSummary', () => {
  it('formats city + radius with a dot separator (matches web)', () => {
    assert.equal(
      formatRegionSummary({ cityName: 'San Francisco', radiusMiles: 25 }),
      'San Francisco · 25mi',
    );
  });

  it('does not coerce zero radius', () => {
    assert.equal(
      formatRegionSummary({ cityName: 'Nowhere', radiusMiles: 0 }),
      'Nowhere · 0mi',
    );
  });
});

describe('RADIUS_OPTIONS / DEFAULT_RADIUS_MILES', () => {
  it('exposes the four canonical preset radii', () => {
    assert.deepEqual([...RADIUS_OPTIONS], [15, 25, 50, 100]);
  });

  it('uses 25mi as the default — matches the first-run picker', () => {
    assert.equal(DEFAULT_RADIUS_MILES, 25);
    assert.ok(RADIUS_OPTIONS.includes(DEFAULT_RADIUS_MILES));
  });
});

describe('parseRegionInput', () => {
  it('accepts a fully populated string-form input', () => {
    const parsed = parseRegionInput({
      cityName: '  Nashville ',
      latitude: '36.1627',
      longitude: '-86.7816',
      radiusMiles: '25',
    });
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.deepEqual(parsed.value, {
        cityName: 'Nashville',
        latitude: 36.1627,
        longitude: -86.7816,
        radiusMiles: 25,
      });
    }
  });

  it('accepts numeric inputs as-is', () => {
    const parsed = parseRegionInput({
      cityName: 'Brooklyn',
      latitude: 40.6782,
      longitude: -73.9442,
      radiusMiles: 50,
    });
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.value.latitude, 40.6782);
      assert.equal(parsed.value.radiusMiles, 50);
    }
  });

  it('rejects empty / whitespace-only city names', () => {
    const parsed = parseRegionInput({
      cityName: '   ',
      latitude: 0,
      longitude: 0,
      radiusMiles: 25,
    });
    assert.equal(parsed.ok, false);
    if (!parsed.ok) assert.equal(parsed.reason, 'missing_city');
  });

  it('rejects out-of-range latitudes', () => {
    const tooHigh = parseRegionInput({
      cityName: 'X', latitude: 91, longitude: 0, radiusMiles: 25,
    });
    assert.equal(tooHigh.ok, false);
    if (!tooHigh.ok) assert.equal(tooHigh.reason, 'invalid_latitude');

    const tooLow = parseRegionInput({
      cityName: 'X', latitude: -91, longitude: 0, radiusMiles: 25,
    });
    assert.equal(tooLow.ok, false);
    if (!tooLow.ok) assert.equal(tooLow.reason, 'invalid_latitude');
  });

  it('rejects out-of-range longitudes', () => {
    const parsed = parseRegionInput({
      cityName: 'X', latitude: 0, longitude: 181, radiusMiles: 25,
    });
    assert.equal(parsed.ok, false);
    if (!parsed.ok) assert.equal(parsed.reason, 'invalid_longitude');
  });

  it('rejects non-numeric latitude strings', () => {
    const parsed = parseRegionInput({
      cityName: 'X', latitude: 'oops', longitude: '0', radiusMiles: '25',
    });
    assert.equal(parsed.ok, false);
    if (!parsed.ok) assert.equal(parsed.reason, 'invalid_latitude');
  });

  it('rejects radius <= 0 or > 500', () => {
    const zero = parseRegionInput({
      cityName: 'X', latitude: 0, longitude: 0, radiusMiles: 0,
    });
    assert.equal(zero.ok, false);
    if (!zero.ok) assert.equal(zero.reason, 'invalid_radius');

    const huge = parseRegionInput({
      cityName: 'X', latitude: 0, longitude: 0, radiusMiles: 501,
    });
    assert.equal(huge.ok, false);
    if (!huge.ok) assert.equal(huge.reason, 'invalid_radius');
  });

  it('coerces radius strings via parseInt (radix 10)', () => {
    const parsed = parseRegionInput({
      cityName: 'X', latitude: 0, longitude: 0, radiusMiles: '50',
    });
    assert.equal(parsed.ok, true);
    if (parsed.ok) assert.equal(parsed.value.radiusMiles, 50);
  });
});
