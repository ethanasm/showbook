import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatCurrency,
  formatSeatDisplay,
  formatVenueLabel,
  formatVenueLocation,
  isVenuePlaceholder,
} from '../utils/format';

describe('formatCurrency', () => {
  it('formats integer dollars', () => {
    assert.equal(formatCurrency(50), '$50.00');
  });

  it('formats decimal dollars', () => {
    assert.equal(formatCurrency(123.45), '$123.45');
  });

  it('parses string input', () => {
    assert.equal(formatCurrency('99.95'), '$99.95');
  });

  it('handles zero', () => {
    assert.equal(formatCurrency(0), '$0.00');
  });

  it('rounds to two decimals', () => {
    assert.equal(formatCurrency(10.999), '$11.00');
  });

  it('formats thousands with commas', () => {
    assert.equal(formatCurrency(1234.5), '$1,234.50');
  });
});

describe('formatSeatDisplay', () => {
  it('uppercases the seat label', () => {
    assert.equal(formatSeatDisplay('row b seat 3'), 'ROW B SEAT 3');
  });

  it('passes through already-upper input', () => {
    assert.equal(formatSeatDisplay('GA'), 'GA');
  });

  it('handles empty string', () => {
    assert.equal(formatSeatDisplay(''), '');
  });
});

describe('isVenuePlaceholder', () => {
  it('flags the literal placeholder strings (case-insensitive)', () => {
    assert.equal(isVenuePlaceholder('Unknown'), true);
    assert.equal(isVenuePlaceholder('UNKNOWN'), true);
    assert.equal(isVenuePlaceholder('  tba '), true);
    assert.equal(isVenuePlaceholder('tbd'), true);
    assert.equal(isVenuePlaceholder('N/A'), true);
  });

  it('treats null / undefined / empty as placeholders', () => {
    assert.equal(isVenuePlaceholder(null), true);
    assert.equal(isVenuePlaceholder(undefined), true);
    assert.equal(isVenuePlaceholder(''), true);
  });

  it('passes real city names through', () => {
    assert.equal(isVenuePlaceholder('Napa Valley'), false);
    assert.equal(isVenuePlaceholder('San Francisco'), false);
    assert.equal(isVenuePlaceholder('NYC'), false);
  });
});

describe('formatVenueLocation', () => {
  it('joins city / state / country with commas', () => {
    assert.equal(
      formatVenueLocation({ city: 'San Francisco', stateRegion: 'CA', country: 'US' }),
      'San Francisco, CA, US',
    );
  });

  it('drops placeholder city values', () => {
    assert.equal(
      formatVenueLocation({ city: 'Unknown', stateRegion: 'CA' }),
      'CA',
    );
    assert.equal(
      formatVenueLocation({ city: 'TBA', stateRegion: null }),
      '',
    );
  });

  it('handles missing fields without producing stray commas', () => {
    assert.equal(formatVenueLocation({ city: 'Napa Valley' }), 'Napa Valley');
    assert.equal(formatVenueLocation({}), '');
  });
});

describe('formatVenueLabel', () => {
  it('joins name / city / state with middle dots', () => {
    assert.equal(
      formatVenueLabel({
        name: 'Citi Field',
        city: 'New York',
        stateRegion: 'NY',
      }),
      'Citi Field · New York · NY',
    );
  });

  it('drops the legacy "Unknown" city the festival import used to write', () => {
    assert.equal(
      formatVenueLabel({
        name: 'Napa Valley',
        city: 'Unknown',
        stateRegion: null,
      }),
      'Napa Valley',
    );
  });
});
