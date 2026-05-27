import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildGoogleMapsOpenPlan } from '../google-maps-deep-link';

describe('buildGoogleMapsOpenPlan', () => {
  it('uses name + city for the native search and pins the web URL to the place id when available', () => {
    const plan = buildGoogleMapsOpenPlan({
      name: 'Madison Square Garden',
      latitude: 40.7505,
      longitude: -73.9934,
      googlePlaceId: 'ChIJhRwB-yFawokR5Phil-QQ3zM',
      city: 'New York',
    });
    assert.ok(plan);
    // Native: name + city search lands on the venue's place card
    // (rather than dropping a coords pin without place info).
    assert.equal(
      plan.primary,
      'comgooglemaps://?q=Madison%20Square%20Garden%2C%20New%20York',
    );
    // Web: query_place_id pins the result to the exact venue page
    // with reviews/photos/hours.
    assert.equal(
      plan.fallback,
      'https://www.google.com/maps/search/?api=1&query=Madison+Square+Garden%2C+New+York&query_place_id=ChIJhRwB-yFawokR5Phil-QQ3zM',
    );
  });

  it('omits query_place_id when no place id is set', () => {
    const plan = buildGoogleMapsOpenPlan({
      name: 'The Fillmore',
      latitude: 37.7841,
      longitude: -122.4327,
      googlePlaceId: null,
      city: 'San Francisco',
    });
    assert.ok(plan);
    assert.equal(
      plan.primary,
      'comgooglemaps://?q=The%20Fillmore%2C%20San%20Francisco',
    );
    assert.equal(
      plan.fallback,
      'https://www.google.com/maps/search/?api=1&query=The+Fillmore%2C+San+Francisco',
    );
  });

  it('still works when only a name is available', () => {
    const plan = buildGoogleMapsOpenPlan({
      name: 'Red Rocks Amphitheatre',
      latitude: null,
      longitude: null,
      googlePlaceId: null,
      city: null,
    });
    assert.ok(plan);
    assert.equal(
      plan.primary,
      'comgooglemaps://?q=Red%20Rocks%20Amphitheatre',
    );
    assert.equal(
      plan.fallback,
      'https://www.google.com/maps/search/?api=1&query=Red+Rocks+Amphitheatre',
    );
  });

  it('pins to the place id even when no coords or city are known', () => {
    const plan = buildGoogleMapsOpenPlan({
      name: 'Royal Albert Hall',
      latitude: null,
      longitude: null,
      googlePlaceId: 'ChIJk_s92NyipBIRUMnDG8Kq2Js',
      city: null,
    });
    assert.ok(plan);
    assert.equal(
      plan.primary,
      'comgooglemaps://?q=Royal%20Albert%20Hall',
    );
    assert.equal(
      plan.fallback,
      'https://www.google.com/maps/search/?api=1&query=Royal+Albert+Hall&query_place_id=ChIJk_s92NyipBIRUMnDG8Kq2Js',
    );
  });

  it('ignores coords when a name is present (search-by-name lands on the place card; coords just drop a pin)', () => {
    const plan = buildGoogleMapsOpenPlan({
      name: 'The Sinclair',
      latitude: 42.3727,
      longitude: -71.1196,
      googlePlaceId: null,
      city: 'Cambridge',
    });
    assert.ok(plan);
    // Crucially, no `42.3727,-71.1196` in either URL — the name+city
    // search resolves to the right venue and lands on the place card.
    assert.equal(
      plan.primary,
      'comgooglemaps://?q=The%20Sinclair%2C%20Cambridge',
    );
    assert.equal(
      plan.fallback,
      'https://www.google.com/maps/search/?api=1&query=The+Sinclair%2C+Cambridge',
    );
  });

  it('falls back to coords only when the venue has no name at all', () => {
    // Defensive: `venues.name` is NOT NULL in the schema, but the
    // input type allows an empty string so guard the case anyway.
    const plan = buildGoogleMapsOpenPlan({
      name: '',
      latitude: 40.7505,
      longitude: -73.9934,
      googlePlaceId: null,
      city: null,
    });
    assert.ok(plan);
    assert.equal(plan.primary, 'comgooglemaps://?q=40.7505%2C-73.9934');
    assert.equal(
      plan.fallback,
      'https://www.google.com/maps/search/?api=1&query=40.7505%2C-73.9934',
    );
  });

  it('returns null when we have nothing to look up', () => {
    const plan = buildGoogleMapsOpenPlan({
      name: '',
      latitude: null,
      longitude: null,
      googlePlaceId: null,
      city: null,
    });
    assert.equal(plan, null);
  });

  it('treats NaN coords as missing and falls back to the name', () => {
    const plan = buildGoogleMapsOpenPlan({
      name: 'Mystery Venue',
      latitude: Number.NaN,
      longitude: Number.NaN,
      googlePlaceId: null,
      city: null,
    });
    assert.ok(plan);
    assert.equal(plan.primary, 'comgooglemaps://?q=Mystery%20Venue');
    assert.equal(
      plan.fallback,
      'https://www.google.com/maps/search/?api=1&query=Mystery+Venue',
    );
  });
});
