/**
 * Unit tests for the venue-search merge + resolve helper that powers
 * the Add/Edit Show typeahead.
 *
 * The hook itself takes a tRPC vanilla client; rather than spin up
 * React to drive the stateful side we cover the pure `mergeVenueSuggestions`
 * branch here. The integration with React state (token-guarded
 * out-of-order responses, loading flag) is left to the mobile web
 * smoke spec — driving it via a hook test harness here would mostly
 * be re-asserting React's own contract.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mergeVenueSuggestions } from '../useVenueSearch';

describe('mergeVenueSuggestions', () => {
  it('returns an empty list when both sides are empty', () => {
    assert.deepEqual(mergeVenueSuggestions([], []), []);
  });

  it('puts local venues before Google Places hits', () => {
    const merged = mergeVenueSuggestions(
      [
        {
          id: 'v1',
          name: 'Bowery Ballroom',
          city: 'New York',
          stateRegion: 'NY',
          country: 'US',
          googlePlaceId: null,
        },
      ],
      [
        {
          placeId: 'p-lyceum',
          displayName: 'Lyceum Theatre',
          formattedAddress: '149 W 45th St, New York, NY',
        },
      ],
    );

    assert.equal(merged.length, 2);
    assert.equal(merged[0]?.id, 'v1');
    assert.equal(merged[0]?.placeId, undefined);
    assert.equal(merged[1]?.id, 'place:p-lyceum');
    assert.equal(merged[1]?.placeId, 'p-lyceum');
    assert.equal(merged[1]?.name, 'Lyceum Theatre');
    assert.equal(merged[1]?.formattedAddress, '149 W 45th St, New York, NY');
  });

  it('drops Google Places hits that already map to a local venue by googlePlaceId', () => {
    // The user has already logged a show at the Lyceum — we shouldn't
    // show them the Google Places duplicate alongside their local row.
    const merged = mergeVenueSuggestions(
      [
        {
          id: 'v1',
          name: 'Lyceum Theatre',
          city: 'New York',
          stateRegion: 'NY',
          country: 'US',
          googlePlaceId: 'p-lyceum',
        },
      ],
      [
        {
          placeId: 'p-lyceum',
          displayName: 'Lyceum Theatre',
          formattedAddress: '149 W 45th St, New York, NY',
        },
        {
          placeId: 'p-other',
          displayName: 'Lyceum NYC',
          formattedAddress: '149 W 45th St, New York, NY',
        },
      ],
    );

    assert.equal(merged.length, 2);
    assert.equal(merged[0]?.id, 'v1');
    assert.equal(merged[1]?.id, 'place:p-other');
  });

  it('omits formattedAddress when Google returns an empty string', () => {
    // VenueTypeahead falls back to `city, stateRegion` when
    // formattedAddress is missing — leaving an empty string in place
    // would render a blank line under the venue name.
    const merged = mergeVenueSuggestions(
      [],
      [
        {
          placeId: 'p1',
          displayName: 'Some Venue',
          formattedAddress: '',
        },
      ],
    );
    assert.equal(merged[0]?.formattedAddress, undefined);
  });
});
